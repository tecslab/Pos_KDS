import type {
  InventoryViews,
  RealtimeEventName,
  RealtimeMessage,
  RealtimeSubscriber,
  RealtimeSubscription,
} from "@/application";

export type InventoryConnectionStatus = "connecting" | "live" | "degraded";

const inventoryEvents = new Set<RealtimeEventName>([
  "inventory.updated",
  "inventory.alert",
]);
type TimerHandle = ReturnType<typeof setInterval>;

export function parseInventoryViewsPayload(
  value: unknown,
): InventoryViews | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.balances) ||
    !Array.isArray(value.movements) ||
    !Array.isArray(value.activeAlerts)
  )
    return null;
  const balances = value.balances.map(parseBalance);
  const movements = value.movements.map(parseMovement);
  const activeAlerts = value.activeAlerts.map(parseAlert);
  if (
    balances.some((entry) => entry === null) ||
    movements.some((entry) => entry === null) ||
    activeAlerts.some((entry) => entry === null)
  )
    return null;
  return Object.freeze({
    balances: Object.freeze(balances as InventoryViews["balances"][number][]),
    movements: Object.freeze(
      movements as InventoryViews["movements"][number][],
    ),
    activeAlerts: Object.freeze(
      activeAlerts as InventoryViews["activeAlerts"][number][],
    ),
  });
}

type InventoryRealtimeControllerOptions = Readonly<{
  subscriber: RealtimeSubscriber;
  restaurantIds: readonly string[];
  refreshInventory(): Promise<void>;
  onStatus(status: InventoryConnectionStatus): void;
  setInterval?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
}>;

/** Live events only request an authorized persisted-data refresh. */
export class InventoryRealtimeController {
  private readonly subscriptions = new Set<RealtimeSubscription>();
  private readonly setInterval: NonNullable<
    InventoryRealtimeControllerOptions["setInterval"]
  >;
  private readonly clearInterval: NonNullable<
    InventoryRealtimeControllerOptions["clearInterval"]
  >;
  private fallbackTimer: TimerHandle | undefined;
  private refreshInFlight: Promise<void> | undefined;
  private refreshRequested = false;
  private terminalFailure = false;
  private started = false;
  private disposed = false;

  constructor(private readonly options: InventoryRealtimeControllerOptions) {
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
    if (!this.terminalFailure && this.fallbackTimer === undefined)
      this.options.onStatus("live");
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

  private async subscribe(restaurantId: string) {
    const subscription = await this.options.subscriber.subscribe({
      restaurantId,
      topic: "inventory",
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

  private onMessage(message: RealtimeMessage) {
    if (inventoryEvents.has(message.eventName)) void this.refreshNow();
  }

  private async drainRefreshes() {
    while (this.refreshRequested && !this.disposed) {
      this.refreshRequested = false;
      try {
        await this.options.refreshInventory();
        if (this.fallbackTimer !== undefined && !this.terminalFailure) {
          this.stopFallback();
          this.options.onStatus("live");
        }
      } catch {
        if (!this.disposed) this.enterDegradedMode(false);
      }
    }
  }

  private enterDegradedMode(terminal: boolean) {
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

  private stopFallback() {
    if (this.fallbackTimer === undefined) return;
    this.clearInterval(this.fallbackTimer);
    this.fallbackTimer = undefined;
  }
}

function parseBalance(
  value: unknown,
): InventoryViews["balances"][number] | null {
  if (
    !isRecord(value) ||
    !baseItem(value) ||
    !isNonblank(value.inventoryItemType) ||
    !decimal(value.minimumStockLevel) ||
    !decimal(value.currentBalance) ||
    typeof value.isBelowMinimum !== "boolean"
  )
    return null;
  return Object.freeze({
    ...baseItem(value)!,
    inventoryItemType: value.inventoryItemType,
    minimumStockLevel: value.minimumStockLevel,
    currentBalance: value.currentBalance,
    isBelowMinimum: value.isBelowMinimum,
  });
}
function parseMovement(
  value: unknown,
): InventoryViews["movements"][number] | null {
  if (
    !isRecord(value) ||
    !baseItem(value) ||
    !isUuid(value.id) ||
    !isNonblank(value.type) ||
    !decimal(value.quantityDelta) ||
    !isRecord(value.recordedBy) ||
    !isUuid(value.recordedBy.id) ||
    !isNonblank(value.recordedBy.displayName) ||
    !instant(value.recordedAt) ||
    !isRecord(value.businessOrigin) ||
    !isNonblank(value.businessOrigin.type) ||
    !isUuid(value.businessOrigin.id) ||
    !nullableText(value.comments) ||
    !nullableUuid(value.reversedMovementId)
  )
    return null;
  return Object.freeze({
    id: value.id,
    ...baseItem(value)!,
    type: value.type,
    quantityDelta: value.quantityDelta,
    recordedBy: Object.freeze({
      id: value.recordedBy.id,
      displayName: value.recordedBy.displayName,
    }),
    recordedAt: value.recordedAt,
    businessOrigin: Object.freeze({
      type: value.businessOrigin.type,
      id: value.businessOrigin.id,
    }),
    comments: value.comments,
    reversedMovementId: value.reversedMovementId,
  });
}
function parseAlert(
  value: unknown,
): InventoryViews["activeAlerts"][number] | null {
  if (
    !isRecord(value) ||
    !baseItem(value) ||
    !isUuid(value.id) ||
    !decimal(value.threshold) ||
    !decimal(value.observedBalance) ||
    !instant(value.openedAt)
  )
    return null;
  return Object.freeze({
    id: value.id,
    ...baseItem(value)!,
    threshold: value.threshold,
    observedBalance: value.observedBalance,
    openedAt: value.openedAt,
  });
}
function baseItem(value: Record<string, unknown>) {
  return isUuid(value.restaurantId) &&
    isNonblank(value.restaurantName) &&
    isUuid(value.inventoryItemId) &&
    isNonblank(value.inventoryItemName) &&
    isNonblank(value.unitOfMeasure)
    ? {
        restaurantId: value.restaurantId,
        restaurantName: value.restaurantName,
        inventoryItemId: value.inventoryItemId,
        inventoryItemName: value.inventoryItemName,
        unitOfMeasure: value.unitOfMeasure,
      }
    : null;
}
function decimal(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+\.\d{3}$/.test(value);
}
function instant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
function nullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
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
