import type {
  KitchenQueueOrder,
  RealtimeEventName,
  RealtimeMessage,
  RealtimeSubscriber,
  RealtimeSubscription,
} from "@/application";

export type KitchenThresholds = Readonly<{
  restaurantId: string;
  warningMinutes: number;
  criticalMinutes: number;
}>;

export type KitchenPriority = "normal" | "warning" | "critical";
export type KitchenConnectionStatus = "connecting" | "live" | "degraded";

const queueEventNames = new Set<RealtimeEventName>([
  "order.created",
  "order.modified",
  "order.cancelled",
]);

export function elapsedMilliseconds(createdAt: string, now: number): number {
  const createdAtMilliseconds = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMilliseconds) || !Number.isFinite(now)) {
    return 0;
  }

  return Math.max(0, now - createdAtMilliseconds);
}

export function kitchenPriority(
  createdAt: string,
  now: number,
  thresholds: Omit<KitchenThresholds, "restaurantId">,
): KitchenPriority {
  const elapsedMinutes = elapsedMilliseconds(createdAt, now) / 60_000;

  if (elapsedMinutes >= thresholds.criticalMinutes) return "critical";
  if (elapsedMinutes >= thresholds.warningMinutes) return "warning";
  return "normal";
}

export function formatElapsedTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0
    ? `${hours} h ${twoDigits(minutes)} min ${twoDigits(seconds)} s`
    : `${minutes} min ${twoDigits(seconds)} s`;
}

export function parseKitchenQueuePayload(
  value: unknown,
): readonly KitchenQueueOrder[] | null {
  if (!isRecord(value) || !Array.isArray(value.orders)) return null;

  const orders: KitchenQueueOrder[] = [];
  for (const candidate of value.orders) {
    const order = parseOrder(candidate);
    if (order === null) return null;
    orders.push(order);
  }

  return Object.freeze(
    orders.sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    ),
  );
}

type TimerHandle = ReturnType<typeof setInterval>;

type KitchenQueueRealtimeControllerOptions = Readonly<{
  subscriber: RealtimeSubscriber;
  restaurantIds: readonly string[];
  refreshQueue(): Promise<void>;
  onStatus(status: KitchenConnectionStatus): void;
  setInterval?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
}>;

/**
 * Coordinates the provider-neutral subscription with a refetch-on-event model.
 * The API remains the source of truth and degraded realtime falls back to
 * periodic authorized reads until the display is remounted.
 */
export class KitchenQueueRealtimeController {
  private readonly subscriptions = new Set<RealtimeSubscription>();
  private readonly setInterval: NonNullable<
    KitchenQueueRealtimeControllerOptions["setInterval"]
  >;
  private readonly clearInterval: NonNullable<
    KitchenQueueRealtimeControllerOptions["clearInterval"]
  >;
  private fallbackTimer: TimerHandle | undefined;
  private refreshInFlight: Promise<void> | undefined;
  private refreshRequested = false;
  private terminalFailure = false;
  private started = false;
  private disposed = false;

  constructor(private readonly options: KitchenQueueRealtimeControllerOptions) {
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

    // Reconcile the SSR snapshot only after every live channel is ready. This
    // closes the gap in which an order can change between the server read and
    // subscription establishment without a message reaching this display.
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
    await Promise.allSettled(
      subscriptions.map((subscription) => subscription.unsubscribe()),
    );
  }

  private async subscribe(restaurantId: string): Promise<void> {
    const subscription = await this.options.subscriber.subscribe({
      restaurantId,
      topic: "kitchen",
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
    if (queueEventNames.has(message.eventName)) void this.refreshNow();
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
      this.fallbackTimer = this.setInterval(() => {
        void this.refreshNow();
      }, 5_000);
    }
  }

  private stopFallback(): void {
    if (this.fallbackTimer === undefined) return;
    this.clearInterval(this.fallbackTimer);
    this.fallbackTimer = undefined;
  }
}

function parseOrder(value: unknown): KitchenQueueOrder | null {
  if (
    !isRecord(value) ||
    !isNonblank(value.id) ||
    !isNonblank(value.restaurantId) ||
    !isNonblank(value.orderNumber) ||
    value.status !== "PENDING" ||
    !isCanonicalInstant(value.createdAt) ||
    !isRecord(value.serviceLocation) ||
    !isNonblank(value.serviceLocation.id) ||
    !isNonblank(value.serviceLocation.name) ||
    !isNonblank(value.serviceLocation.type) ||
    !Array.isArray(value.lines)
  ) {
    return null;
  }

  const lines = value.lines.map(parseLine);
  if (lines.some((line) => line === null)) return null;

  return Object.freeze({
    id: value.id,
    restaurantId: value.restaurantId,
    orderNumber: value.orderNumber,
    status: "PENDING",
    serviceLocation: Object.freeze({
      id: value.serviceLocation.id,
      name: value.serviceLocation.name,
      type: value.serviceLocation.type,
    }),
    createdAt: value.createdAt,
    lines: Object.freeze(lines),
  }) as KitchenQueueOrder;
}

function parseLine(value: unknown): KitchenQueueOrder["lines"][number] | null {
  if (
    !isRecord(value) ||
    !isNonblank(value.id) ||
    !isNonblank(value.productName) ||
    !Number.isInteger(value.quantity) ||
    (value.quantity as number) < 1 ||
    !Array.isArray(value.selectedOptions) ||
    !Array.isArray(value.removedIngredients) ||
    (value.observations !== null && typeof value.observations !== "string")
  ) {
    return null;
  }

  const selectedOptions = value.selectedOptions.map(parseModification);
  const removedIngredients = value.removedIngredients.map(parseModification);
  if (
    selectedOptions.some((modification) => modification === null) ||
    removedIngredients.some((modification) => modification === null)
  ) {
    return null;
  }

  return Object.freeze({
    id: value.id,
    productName: value.productName,
    quantity: value.quantity as number,
    selectedOptions: Object.freeze(selectedOptions),
    removedIngredients: Object.freeze(removedIngredients),
    observations: value.observations,
  }) as KitchenQueueOrder["lines"][number];
}

function parseModification(value: unknown) {
  return isRecord(value) && isNonblank(value.id) && isNonblank(value.name)
    ? Object.freeze({ id: value.id, name: value.name })
    : null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
