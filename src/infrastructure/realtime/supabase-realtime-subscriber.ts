import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
} from "@supabase/supabase-js";

import {
  NoOpOperationalTelemetryRecorder,
  classifyTelemetryError,
  parseRealtimeMessage,
  realtimeTopicName,
  telemetryDuration,
  telemetryNow,
  type MonotonicClock,
  type OperationalTelemetryRecorder,
  type RealtimeMessageHandler,
  type RealtimeSubscriber,
  type RealtimeSubscription,
  type RealtimeSubscriptionFailure,
  type RealtimeSubscriptionRequest,
  type RealtimeTopic,
} from "../../application";
import { SystemMonotonicClock } from "../observability/system-monotonic-clock";

import type { SupabaseRealtimeClient } from "./supabase-realtime-client";
import { SupabaseRealtimeError } from "./supabase-realtime-error";

type HandlerRegistration = Readonly<{
  onMessage: RealtimeMessageHandler;
  onTerminalFailure:
    ((failure: RealtimeSubscriptionFailure) => void) | undefined;
}>;

type SharedChannel = {
  channel: RealtimeChannel;
  readonly restaurantId: string;
  readonly topic: RealtimeTopic;
  readonly handlers: Map<symbol, HandlerRegistration>;
  readonly initialReady: Promise<void>;
  cleanup: Promise<void> | undefined;
  transition: Promise<void> | undefined;
  cancelJoin: (() => void) | undefined;
  phase: "joining" | "ready" | "recovering" | "closed";
};

const terminalFailure: RealtimeSubscriptionFailure = Object.freeze({
  code: "REALTIME_SUBSCRIPTION_TERMINATED",
});

export class SupabaseRealtimeSubscriber implements RealtimeSubscriber {
  private readonly channels = new Map<string, SharedChannel>();

  constructor(
    private readonly client: SupabaseRealtimeClient,
    private readonly telemetry: OperationalTelemetryRecorder = new NoOpOperationalTelemetryRecorder(),
    private readonly clock: MonotonicClock = new SystemMonotonicClock(),
  ) {}

  async subscribe(
    request: RealtimeSubscriptionRequest,
  ): Promise<RealtimeSubscription> {
    const startedAt = telemetryNow(this.clock);

    try {
      const subscription = await this.subscribeObserved(request);
      this.recordOperation("subscribe", "success", undefined, startedAt);
      return subscription;
    } catch (error) {
      this.recordOperation(
        "subscribe",
        "failure",
        classifyTelemetryError(error),
        startedAt,
      );
      throw error;
    }
  }

  private async subscribeObserved(
    request: RealtimeSubscriptionRequest,
  ): Promise<RealtimeSubscription> {
    const topicName = realtimeTopicName(request.restaurantId, request.topic);

    if (topicName === null) {
      throw new SupabaseRealtimeError("Invalid realtime subscription.");
    }

    const shared =
      this.channels.get(topicName) ?? this.createChannel(topicName, request);
    const registrationId = Symbol("realtime-handler");
    shared.handlers.set(registrationId, {
      onMessage: request.onMessage,
      onTerminalFailure: request.onTerminalFailure,
    });

    try {
      await shared.initialReady;
      const activeTransition = shared.transition;

      if (activeTransition !== undefined) {
        await activeTransition;
      }
    } catch (error) {
      shared.handlers.delete(registrationId);
      throw error;
    }

    return new IdempotentSubscription(() =>
      this.release(topicName, shared, registrationId),
    );
  }

  private createChannel(
    topicName: string,
    request: RealtimeSubscriptionRequest,
  ): SharedChannel {
    this.assertTopicAvailable(topicName);
    const channel = this.client.channel(topicName, {
      config: { private: true },
    });
    let resolveInitial!: () => void;
    let rejectInitial!: (error: unknown) => void;
    const initialReady = new Promise<void>((resolve, reject) => {
      resolveInitial = resolve;
      rejectInitial = reject;
    });
    const shared: SharedChannel = {
      channel,
      restaurantId: request.restaurantId,
      topic: request.topic,
      handlers: new Map(),
      initialReady,
      cleanup: undefined,
      transition: undefined,
      cancelJoin: undefined,
      phase: "joining",
    };
    this.channels.set(topicName, shared);
    this.bindChannel(
      topicName,
      shared,
      channel,
      () => {
        shared.phase = "ready";
        resolveInitial();
      },
      (error) => {
        void this.close(topicName, shared).then(
          () => rejectInitial(error),
          () => rejectInitial(error),
        );
      },
    );

    return shared;
  }

  private bindChannel(
    topicName: string,
    shared: SharedChannel,
    channel: RealtimeChannel,
    onReady: () => void,
    onJoinFailure: (error: unknown) => void,
  ): void {
    let joinSettled = false;

    const failJoin = (error: unknown) => {
      if (!joinSettled) {
        joinSettled = true;
        shared.cancelJoin = undefined;
        onJoinFailure(error);
      }
    };
    shared.cancelJoin = () =>
      failJoin(new SupabaseRealtimeError("Realtime subscription was closed."));

    try {
      channel
        .on("broadcast", { event: "*" }, (message: unknown) => {
          if (shared.channel !== channel || shared.phase === "closed") {
            return;
          }

          const raw = unwrapBroadcast(message);
          const parsed = parseRealtimeMessage(
            raw.eventName,
            raw.envelope,
            shared.restaurantId,
            shared.topic,
          );

          if (parsed !== null) {
            for (const registration of shared.handlers.values()) {
              try {
                registration.onMessage(parsed);
              } catch {
                // A consumer failure must not suppress delivery to other
                // subscribers or escape into the transport callback.
              }
            }
          }
        })
        .subscribe((status, error) => {
          if (shared.channel !== channel) {
            return;
          }

          if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
            if (!joinSettled) {
              joinSettled = true;
              shared.cancelJoin = undefined;
              onReady();
            }
            return;
          }

          if (
            status !== REALTIME_SUBSCRIBE_STATES.TIMED_OUT &&
            status !== REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR &&
            status !== REALTIME_SUBSCRIBE_STATES.CLOSED
          ) {
            return;
          }

          const failure =
            error ??
            new SupabaseRealtimeError(
              `Realtime subscription failed: ${status}.`,
            );

          if (!joinSettled) {
            failJoin(failure);
          } else if (shared.phase === "ready") {
            this.beginRecovery(topicName, shared);
          }
        });
    } catch (error) {
      failJoin(error);
    }
  }

  private beginRecovery(topicName: string, shared: SharedChannel): void {
    if (shared.transition !== undefined || shared.handlers.size === 0) {
      return;
    }

    shared.phase = "recovering";
    const recovery = this.recover(topicName, shared);
    shared.transition = recovery;
    void recovery
      .catch(() => this.terminate(topicName, shared))
      .finally(() => {
        if (shared.transition === recovery) {
          shared.transition = undefined;
        }
      });
  }

  private async recover(
    topicName: string,
    shared: SharedChannel,
  ): Promise<void> {
    const startedAt = telemetryNow(this.clock);

    try {
      await this.recoverObserved(topicName, shared);
      this.recordOperation("recover", "success", undefined, startedAt);
    } catch (error) {
      this.recordOperation(
        "recover",
        "failure",
        classifyTelemetryError(error),
        startedAt,
      );
      throw error;
    }
  }

  private async recoverObserved(
    topicName: string,
    shared: SharedChannel,
  ): Promise<void> {
    await this.removeCurrentChannel(shared);

    if (
      this.channels.get(topicName) !== shared ||
      shared.handlers.size === 0 ||
      shared.phase === "closed"
    ) {
      return;
    }

    this.assertTopicAvailable(topicName);
    const channel = this.client.channel(topicName, {
      config: { private: true },
    });
    shared.channel = channel;
    shared.cleanup = undefined;
    shared.phase = "joining";

    await new Promise<void>((resolve, reject) => {
      this.bindChannel(
        topicName,
        shared,
        channel,
        () => {
          shared.phase = "ready";
          resolve();
        },
        reject,
      );
    });
  }

  private recordOperation(
    operation: "subscribe" | "recover",
    outcome: "success" | "failure",
    errorClass: ReturnType<typeof classifyTelemetryError> | undefined,
    startedAt: number,
  ): void {
    try {
      this.telemetry.record({
        event: "realtime.operation",
        operation,
        outcome,
        durationMs: telemetryDuration(this.clock, startedAt),
        ...(errorClass === undefined ? {} : { errorClass }),
      });
    } catch {
      // Custom telemetry implementations cannot affect subscriptions.
    }
  }

  private terminate(topicName: string, shared: SharedChannel): void {
    if (this.channels.get(topicName) !== shared || shared.handlers.size === 0) {
      return;
    }

    this.channels.delete(topicName);
    shared.phase = "closed";
    shared.cancelJoin = undefined;
    const registrations = [...shared.handlers.values()];
    shared.handlers.clear();
    void this.removeCurrentChannel(shared).catch(() => undefined);

    for (const registration of registrations) {
      try {
        registration.onTerminalFailure?.(terminalFailure);
      } catch {
        // Failure observers are isolated for the same reason as message
        // handlers: one consumer must not block the others.
      }
    }
  }

  private async release(
    topicName: string,
    shared: SharedChannel,
    registrationId: symbol,
  ): Promise<void> {
    shared.handlers.delete(registrationId);

    if (shared.handlers.size === 0) {
      await this.close(topicName, shared);
    }
  }

  private close(topicName: string, shared: SharedChannel): Promise<void> {
    if (this.channels.get(topicName) === shared) {
      this.channels.delete(topicName);
    }
    shared.phase = "closed";
    shared.handlers.clear();
    shared.cancelJoin?.();
    shared.cancelJoin = undefined;
    return this.removeCurrentChannel(shared);
  }

  private removeCurrentChannel(shared: SharedChannel): Promise<void> {
    shared.cleanup ??= this.remove(shared.channel);
    return shared.cleanup;
  }

  private async remove(channel: RealtimeChannel): Promise<void> {
    const result = await this.client.removeChannel(channel);

    if (result !== "ok") {
      throw new SupabaseRealtimeError("Realtime channel cleanup failed.");
    }
  }

  private assertTopicAvailable(topicName: string): void {
    const sdkTopic = `realtime:${topicName}`;

    if (
      this.client
        .getChannels()
        .some((candidate) => candidate.topic === sdkTopic)
    ) {
      throw new SupabaseRealtimeError(
        "Realtime topic is already managed outside this subscriber.",
      );
    }
  }
}

class IdempotentSubscription implements RealtimeSubscription {
  private removal: Promise<void> | undefined;

  constructor(private readonly remove: () => Promise<void>) {}

  unsubscribe(): Promise<void> {
    this.removal ??= this.remove();
    return this.removal;
  }
}

function unwrapBroadcast(message: unknown): Readonly<{
  eventName: unknown;
  envelope: unknown;
}> {
  if (typeof message !== "object" || message === null) {
    return { eventName: undefined, envelope: undefined };
  }

  const candidate = message as Record<string, unknown>;

  return {
    eventName: candidate.event,
    envelope: candidate.payload,
  };
}
