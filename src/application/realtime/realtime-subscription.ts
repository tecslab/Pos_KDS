import type { RealtimeMessage, RealtimeTopic } from "./realtime-event";

export type RealtimeMessageHandler = (message: RealtimeMessage) => void;

export type RealtimeSubscriptionFailure = Readonly<{
  code: "REALTIME_SUBSCRIPTION_TERMINATED";
}>;

export type RealtimeSubscriptionRequest = Readonly<{
  restaurantId: string;
  topic: RealtimeTopic;
  onMessage: RealtimeMessageHandler;
  onTerminalFailure?: (failure: RealtimeSubscriptionFailure) => void;
}>;

export interface RealtimeSubscription {
  unsubscribe(): Promise<void>;
}

export interface RealtimeSubscriber {
  subscribe(
    request: RealtimeSubscriptionRequest,
  ): Promise<RealtimeSubscription>;
}
