import type {
  DeliveryQueueItem,
  RealtimeEventName,
  RealtimeMessage,
  RealtimeSubscriber,
  RealtimeSubscription,
} from "@/application";

export type DeliveryThresholds = Readonly<{
  restaurantId: string;
  warningMinutes: number;
  criticalMinutes: number;
}>;

export type DeliveryPriority = "normal" | "warning" | "critical";
export type DeliveryConnectionStatus = "connecting" | "live" | "degraded";

export type DeliveryFilters = Readonly<{
  serviceLocationId: string;
  orderNumber: string;
  minimumWaitingMinutes: string;
}>;

const deliveryEventNames = new Set<RealtimeEventName>([
  "order.cancelled",
  "kitchen.status.updated",
  "delivery.status.updated",
]);

export function deliveryPriority(
  readyAt: string,
  now: number,
  thresholds: Omit<DeliveryThresholds, "restaurantId">,
): DeliveryPriority {
  const elapsedMinutes = elapsedMilliseconds(readyAt, now) / 60_000;

  if (elapsedMinutes >= thresholds.criticalMinutes) return "critical";
  if (elapsedMinutes >= thresholds.warningMinutes) return "warning";
  return "normal";
}

export function elapsedMilliseconds(readyAt: string, now: number): number {
  const readyAtMilliseconds = Date.parse(readyAt);
  if (!Number.isFinite(readyAtMilliseconds) || !Number.isFinite(now)) return 0;
  return Math.max(0, now - readyAtMilliseconds);
}

export function formatWaitingTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? `${hours} h ${twoDigits(minutes)} min ${twoDigits(seconds)} s`
    : `${minutes} min ${twoDigits(seconds)} s`;
}

export function parseDeliveryQueuePayload(
  value: unknown,
): readonly DeliveryQueueItem[] | null {
  if (!isRecord(value) || !Array.isArray(value.orders)) return null;

  const orders = value.orders.map(parseOrder);
  if (orders.some((order) => order === null)) return null;

  return Object.freeze(
    (orders as DeliveryQueueItem[]).sort(
      (left, right) =>
        left.readyAt.localeCompare(right.readyAt) ||
        left.id.localeCompare(right.id),
    ),
  );
}

export function queryForDeliveryFilters(
  filters: DeliveryFilters,
): string | null {
  const serviceLocationId = filters.serviceLocationId.trim();
  const orderNumber = filters.orderNumber.trim();
  const minimumWaitingMinutes = filters.minimumWaitingMinutes.trim();

  if (
    (serviceLocationId.length > 0 && !isUuid(serviceLocationId)) ||
    (orderNumber.length > 0 && orderNumber.length > 100) ||
    (minimumWaitingMinutes.length > 0 &&
      (!/^(0|[1-9][0-9]*)$/.test(minimumWaitingMinutes) ||
        Number(minimumWaitingMinutes) > 24 * 60))
  ) {
    return null;
  }

  const parameters = new URLSearchParams();
  if (serviceLocationId) parameters.set("serviceLocationId", serviceLocationId);
  if (orderNumber) parameters.set("orderNumber", orderNumber);
  if (minimumWaitingMinutes) {
    parameters.set("minimumWaitingMinutes", minimumWaitingMinutes);
  }
  const query = parameters.toString();
  return query.length === 0 ? "" : `?${query}`;
}

type TimerHandle = ReturnType<typeof setInterval>;

type DeliveryQueueRealtimeControllerOptions = Readonly<{
  subscriber: RealtimeSubscriber;
  restaurantIds: readonly string[];
  refreshQueue(): Promise<void>;
  onStatus(status: DeliveryConnectionStatus): void;
  setInterval?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
}>;

/** Keeps the API authoritative and falls back to authorized polling on failure. */
export class DeliveryQueueRealtimeController {
  private readonly subscriptions = new Set<RealtimeSubscription>();
  private readonly setInterval: NonNullable<
    DeliveryQueueRealtimeControllerOptions["setInterval"]
  >;
  private readonly clearInterval: NonNullable<
    DeliveryQueueRealtimeControllerOptions["clearInterval"]
  >;
  private fallbackTimer: TimerHandle | undefined;
  private refreshInFlight: Promise<void> | undefined;
  private refreshRequested = false;
  private terminalFailure = false;
  private started = false;
  private disposed = false;

  constructor(
    private readonly options: DeliveryQueueRealtimeControllerOptions,
  ) {
    this.setInterval =
      options.setInterval ??
      ((callback, delay) => setInterval(callback, delay));
    this.clearInterval =
      options.clearInterval ?? ((handle) => clearInterval(handle));
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    this.options.onStatus("connecting");

    const subscriptions = await Promise.allSettled(
      [...new Set(this.options.restaurantIds)].map((restaurantId) =>
        this.subscribe(restaurantId),
      ),
    );
    if (this.disposed) return;

    if (subscriptions.some((result) => result.status === "rejected")) {
      this.enterDegradedMode(true);
      void this.refreshNow();
      return;
    }

    await this.refreshNow();
    if (!this.terminalFailure && this.fallbackTimer === undefined) {
      this.options.onStatus("live");
    }
  }

  refreshNow(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.refreshRequested = true;
    if (this.refreshInFlight === undefined) {
      this.refreshInFlight = this.drainRefreshes().finally(() => {
        this.refreshInFlight = undefined;
        if (this.refreshRequested && !this.disposed) void this.refreshNow();
      });
    }
    return this.refreshInFlight;
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopFallback();
    const subscriptions = [...this.subscriptions];
    this.subscriptions.clear();
    await Promise.allSettled(subscriptions.map((entry) => entry.unsubscribe()));
  }

  private async subscribe(restaurantId: string): Promise<void> {
    const subscription = await this.options.subscriber.subscribe({
      restaurantId,
      topic: "delivery",
      onMessage: (message) => this.onMessage(message),
      onTerminalFailure: () => {
        this.enterDegradedMode(true);
        void this.refreshNow();
      },
    });
    if (this.disposed) {
      await subscription.unsubscribe();
      return;
    }
    this.subscriptions.add(subscription);
  }

  private onMessage(message: RealtimeMessage): void {
    if (deliveryEventNames.has(message.eventName)) void this.refreshNow();
  }

  private async drainRefreshes(): Promise<void> {
    while (this.refreshRequested && !this.disposed) {
      this.refreshRequested = false;
      try {
        await this.options.refreshQueue();
        if (this.fallbackTimer !== undefined && !this.terminalFailure) {
          this.stopFallback();
          this.options.onStatus("live");
        }
      } catch {
        if (!this.disposed) this.enterDegradedMode(false);
      }
    }
  }

  private enterDegradedMode(terminal: boolean): void {
    if (this.disposed) return;
    this.terminalFailure ||= terminal;
    this.options.onStatus("degraded");
    if (this.fallbackTimer === undefined) {
      this.fallbackTimer = this.setInterval(
        () => void this.refreshNow(),
        5_000,
      );
    }
  }

  private stopFallback(): void {
    if (this.fallbackTimer === undefined) return;
    this.clearInterval(this.fallbackTimer);
    this.fallbackTimer = undefined;
  }
}

function parseOrder(value: unknown): DeliveryQueueItem | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.restaurantId) ||
    !isNonblank(value.orderNumber) ||
    value.status !== "READY" ||
    !isCanonicalInstant(value.createdAt) ||
    !isCanonicalInstant(value.readyAt) ||
    !isRecord(value.serviceLocation) ||
    !isUuid(value.serviceLocation.id) ||
    !isNonblank(value.serviceLocation.name) ||
    !isNonblank(value.serviceLocation.type) ||
    !Number.isSafeInteger(value.waitingTimeSeconds) ||
    (value.waitingTimeSeconds as number) < 0 ||
    !Number.isSafeInteger(value.productCount) ||
    (value.productCount as number) < 1 ||
    !Array.isArray(value.specialObservations) ||
    !value.specialObservations.every(
      (observation) => typeof observation === "string",
    )
  ) {
    return null;
  }

  return Object.freeze({
    id: value.id,
    restaurantId: value.restaurantId,
    orderNumber: value.orderNumber,
    status: "READY",
    serviceLocation: Object.freeze({
      id: value.serviceLocation.id,
      name: value.serviceLocation.name,
      type: value.serviceLocation.type,
    }),
    createdAt: value.createdAt,
    readyAt: value.readyAt,
    waitingTimeSeconds: value.waitingTimeSeconds as number,
    productCount: value.productCount as number,
    specialObservations: Object.freeze([...value.specialObservations]),
  });
}

function twoDigits(value: number): string {
  return value.toString().padStart(2, "0");
}

function isCanonicalInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
