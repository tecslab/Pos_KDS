import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  NoOpOperationalTelemetryRecorder,
  classifyTelemetryError,
  mapDomainEventToRealtime,
  realtimeTopicName,
  telemetryDuration,
  telemetryNow,
  type DomainEventPublisher,
  type MonotonicClock,
  type OperationalTelemetryRecorder,
  type RealtimeDomainEvent,
  type RealtimePublication,
} from "../../application";
import { SystemMonotonicClock } from "../observability/system-monotonic-clock";

import type { SupabaseRealtimeClient } from "./supabase-realtime-client";
import { SupabaseRealtimeError } from "./supabase-realtime-error";

/**
 * Publishes private Supabase Broadcast messages sequentially. The REST
 * broadcast acknowledgement is awaited before the next publication begins.
 */
export class SupabaseRealtimePublisher implements DomainEventPublisher<RealtimeDomainEvent> {
  constructor(
    private readonly client: SupabaseRealtimeClient,
    private readonly telemetry: OperationalTelemetryRecorder = new NoOpOperationalTelemetryRecorder(),
    private readonly clock: MonotonicClock = new SystemMonotonicClock(),
  ) {}

  async publish(events: readonly RealtimeDomainEvent[]): Promise<void> {
    for (const event of events) {
      const mapped = mapDomainEventToRealtime(event);

      if (!mapped.ok) {
        throw new SupabaseRealtimeError("Invalid realtime domain event.");
      }

      for (const publication of mapped.value) {
        await this.publishOne(publication);
      }
    }
  }

  private async publishOne(publication: RealtimePublication): Promise<void> {
    const startedAt = telemetryNow(this.clock);

    try {
      await this.publishOneObserved(publication);
      this.recordOperation("success", undefined, startedAt);
    } catch (error) {
      this.recordOperation("failure", classifyTelemetryError(error), startedAt);
      throw error;
    }
  }

  private async publishOneObserved(
    publication: RealtimePublication,
  ): Promise<void> {
    const topicName = realtimeTopicName(
      publication.envelope.restaurantId,
      publication.topic,
    );

    if (topicName === null) {
      throw new SupabaseRealtimeError("Invalid realtime topic.");
    }

    const existingChannel = this.client
      .getChannels()
      .find((candidate) => candidate.topic === `realtime:${topicName}`);

    if (existingChannel !== undefined && !existingChannel.private) {
      throw new SupabaseRealtimeError(
        "Refusing to publish through a public realtime channel.",
      );
    }

    const channel = this.client.channel(topicName, {
      config: { private: true },
    });
    const ownsChannel = existingChannel === undefined;
    let publishFailed = false;

    try {
      const response = await channel.httpSend(
        publication.eventName,
        publication.envelope,
      );

      if (!response.success) {
        throw new SupabaseRealtimeError("Realtime publication was rejected.");
      }
    } catch (error) {
      publishFailed = true;
      throw error;
    } finally {
      if (ownsChannel) {
        await this.removeChannel(channel, publishFailed);
      }
    }
  }

  private recordOperation(
    outcome: "success" | "failure",
    errorClass: ReturnType<typeof classifyTelemetryError> | undefined,
    startedAt: number,
  ): void {
    try {
      this.telemetry.record({
        event: "realtime.operation",
        operation: "publish",
        outcome,
        durationMs: telemetryDuration(this.clock, startedAt),
        ...(errorClass === undefined ? {} : { errorClass }),
      });
    } catch {
      // Custom telemetry implementations cannot affect publication.
    }
  }

  private async removeChannel(
    channel: RealtimeChannel,
    suppressFailure: boolean,
  ): Promise<void> {
    try {
      const result = await this.client.removeChannel(channel);

      if (result !== "ok") {
        throw new SupabaseRealtimeError("Realtime channel cleanup failed.");
      }
    } catch (error) {
      if (!suppressFailure) {
        throw error;
      }
    }
  }
}
