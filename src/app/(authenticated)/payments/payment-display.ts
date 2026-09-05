import type {
  PendingPaymentOrder,
  RealtimeEventName,
  RealtimeMessage,
  RealtimeSubscriber,
  RealtimeSubscription,
} from "@/application";

export type PaymentConnectionStatus = "connecting" | "live" | "degraded";

export type PaymentRegistrationResult = Readonly<{
  paymentId: string;
  orderId: string;
  basketId: string;
  basketOutstandingBalance: string;
  basketStatus: "PENDING" | "PAID";
  orderStatus: "DELIVERED" | "PAID";
}>;

export type PaymentMethodChoice = Readonly<{
  id: string;
  restaurantId: string;
  code: string;
  name: string;
  displayOrder: number;
}>;

export type PaymentDetailSelection = Readonly<{
  orderId: string | null;
  basketId: string | null;
  methodId: string;
}>;

const paymentEvents = new Set<RealtimeEventName>([
  "order.created",
  "order.modified",
  "order.cancelled",
  "delivery.status.updated",
  "payment.completed",
]);
const moneyPattern = /^\d{1,10}(?:\.\d{1,2})?$/;

export function formatCurrency(amount: string): string {
  const cents = moneyToCents(amount);
  if (cents === null) return "—";
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(cents) / 100);
}

/** Returns the canonical API money string or null before a financial request. */
export function canonicalPaymentAmount(value: string): string | null {
  if (!moneyPattern.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents =
    BigInt(whole) * BigInt(100) + BigInt((fraction + "00").slice(0, 2));
  if (cents <= BigInt(0) || cents > BigInt("999999999999")) return null;
  return formatCents(cents);
}

export function amountExceedsBalance(amount: string, balance: string): boolean {
  const amountCents = moneyToCents(amount);
  const balanceCents = moneyToCents(balance);
  return (
    amountCents === null || balanceCents === null || amountCents > balanceCents
  );
}

/** Derives presentation defaults from one authoritative order DTO. */
export function paymentDetailSelection(
  order: PendingPaymentOrder | null,
  methods: readonly PaymentMethodChoice[],
): PaymentDetailSelection {
  if (order === null) {
    return Object.freeze({ orderId: null, basketId: null, methodId: "" });
  }
  const method = methods
    .filter((entry) => entry.restaurantId === order.restaurantId)
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder ||
        left.name.localeCompare(right.name),
    )[0];
  return Object.freeze({
    orderId: order.id,
    basketId:
      order.baskets.find((basket) => basket.status === "PENDING")?.id ?? null,
    methodId: method?.id ?? "",
  });
}

export function canRegisterSelectedPayment(
  order: PendingPaymentOrder | null,
  basket: PendingPaymentOrder["baskets"][number] | undefined,
  canRegister: boolean,
  loadingDetail: boolean,
  hasMethod: boolean,
): boolean {
  return (
    canRegister &&
    !loadingDetail &&
    order?.status === "DELIVERED" &&
    basket?.status === "PENDING" &&
    hasMethod
  );
}

/** Maps only public API codes to action-specific, non-sensitive feedback. */
export function paymentRegistrationErrorMessage(value: unknown): string {
  const code =
    isRecord(value) && isRecord(value.error) ? value.error.code : null;
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
      return "Tu sesión venció. Inicia sesión nuevamente antes de registrar el pago.";
    case "UNAUTHORIZED":
      return "No tienes permiso para registrar pagos.";
    case "INVALID_PAYMENT":
      return "Revisa el monto, método y datos del pago.";
    case "NOT_FOUND":
      return "La cuenta ya no está disponible. Actualiza las cuentas e inténtalo nuevamente.";
    case "ORDER_NOT_DELIVERED":
      return "Solo se pueden registrar pagos para órdenes entregadas.";
    case "BASKET_ALREADY_PAID":
      return "Esta cuenta ya fue pagada. Actualiza las cuentas para ver el saldo actual.";
    case "PAYMENT_METHOD_UNAVAILABLE":
      return "El método seleccionado ya no está disponible. Elige otro método activo.";
    case "OVERAGE_NOT_AUTHORIZED":
      return "No tienes autorización para registrar un pago superior al saldo.";
    case "OVERAGE_REASON_REQUIRED":
      return "Un pago superior al saldo requiere una justificación autorizada.";
    default:
      return "No se pudo registrar el pago. Intenta nuevamente.";
  }
}

export function paymentRegistrationRequest(
  basketId: string,
  paymentMethodId: string,
  amount: string,
  referenceNumber: string,
  comments: string,
  overageReason = "",
) {
  return Object.freeze({
    basketId,
    paymentMethodId,
    amount,
    ...(referenceNumber.trim().length > 0 ? { referenceNumber } : {}),
    ...(comments.trim().length > 0 ? { comments } : {}),
    ...(overageReason.trim().length > 0 ? { overageReason } : {}),
  });
}

export function parsePendingPaymentOrders(
  value: unknown,
): readonly PendingPaymentOrder[] | null {
  if (!isRecord(value) || !Array.isArray(value.orders)) return null;
  const orders = value.orders.map(parseOrder);
  if (orders.some((order) => order === null)) return null;
  return Object.freeze(orders as PendingPaymentOrder[]);
}

export function parsePendingPaymentOrder(
  value: unknown,
): PendingPaymentOrder | null {
  return isRecord(value) ? parseOrder(value.order) : null;
}

export function parsePaymentRegistrationResult(
  value: unknown,
  expectedBasketId: string,
): PaymentRegistrationResult | null {
  if (!isRecord(value) || !isRecord(value.payment)) return null;
  const payment = value.payment;
  if (
    !isUuid(payment.paymentId) ||
    !isUuid(payment.orderId) ||
    payment.basketId !== expectedBasketId ||
    !isCanonicalMoney(payment.basketOutstandingBalance) ||
    (payment.basketStatus !== "PENDING" && payment.basketStatus !== "PAID") ||
    (payment.orderStatus !== "DELIVERED" && payment.orderStatus !== "PAID")
  ) {
    return null;
  }
  return Object.freeze({
    paymentId: payment.paymentId,
    orderId: payment.orderId,
    basketId: payment.basketId,
    basketOutstandingBalance: payment.basketOutstandingBalance,
    basketStatus: payment.basketStatus,
    orderStatus: payment.orderStatus,
  });
}

type TimerHandle = ReturnType<typeof setInterval>;

type PaymentRealtimeControllerOptions = Readonly<{
  subscriber: RealtimeSubscriber;
  restaurantIds: readonly string[];
  refreshPayments(): Promise<void>;
  onStatus(status: PaymentConnectionStatus): void;
  setInterval?: (callback: () => void, milliseconds: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
}>;

/** The protected payment APIs remain authoritative after every live event. */
export class PaymentRealtimeController {
  private readonly subscriptions = new Set<RealtimeSubscription>();
  private readonly setInterval: NonNullable<
    PaymentRealtimeControllerOptions["setInterval"]
  >;
  private readonly clearInterval: NonNullable<
    PaymentRealtimeControllerOptions["clearInterval"]
  >;
  private fallbackTimer: TimerHandle | undefined;
  private refreshInFlight: Promise<void> | undefined;
  private refreshRequested = false;
  private terminalFailure = false;
  private started = false;
  private disposed = false;

  constructor(private readonly options: PaymentRealtimeControllerOptions) {
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
      topic: "payments",
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
    if (paymentEvents.has(message.eventName)) void this.refreshNow();
  }

  private async drainRefreshes(): Promise<void> {
    while (this.refreshRequested && !this.disposed) {
      this.refreshRequested = false;
      try {
        await this.options.refreshPayments();
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

function parseOrder(value: unknown): PendingPaymentOrder | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.restaurantId) ||
    !isNonblank(value.orderNumber) ||
    !["PENDING", "READY", "ON_THE_WAY", "DELIVERED"].includes(
      String(value.status),
    ) ||
    !isRecord(value.serviceLocation) ||
    !isUuid(value.serviceLocation.id) ||
    !isNonblank(value.serviceLocation.name) ||
    !isNonblank(value.serviceLocation.type) ||
    !isRecord(value.assignedWaiter) ||
    !isUuid(value.assignedWaiter.id) ||
    !isNonblank(value.assignedWaiter.displayName) ||
    !isCanonicalMoney(value.totalAmount) ||
    !isCanonicalMoney(value.paidAmount) ||
    !isCanonicalMoney(value.outstandingBalance) ||
    !isCanonicalInstant(value.createdAt) ||
    !nullableInstant(value.deliveredAt) ||
    !Array.isArray(value.baskets) ||
    value.baskets.length === 0
  ) {
    return null;
  }
  const baskets = value.baskets.map(parseBasket);
  if (baskets.some((basket) => basket === null)) return null;
  return Object.freeze({
    id: value.id,
    restaurantId: value.restaurantId,
    orderNumber: value.orderNumber,
    status: value.status as PendingPaymentOrder["status"],
    serviceLocation: Object.freeze({
      id: value.serviceLocation.id,
      name: value.serviceLocation.name,
      type: value.serviceLocation.type,
    }),
    assignedWaiter: Object.freeze({
      id: value.assignedWaiter.id,
      displayName: value.assignedWaiter.displayName,
    }),
    totalAmount: value.totalAmount,
    paidAmount: value.paidAmount,
    outstandingBalance: value.outstandingBalance,
    createdAt: value.createdAt,
    deliveredAt: value.deliveredAt as string | null,
    baskets: Object.freeze(baskets as PendingPaymentOrder["baskets"][number][]),
  });
}

function parseBasket(
  value: unknown,
): PendingPaymentOrder["baskets"][number] | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    (value.status !== "PENDING" && value.status !== "PAID") ||
    !isCanonicalMoney(value.totalAmount) ||
    !isCanonicalMoney(value.paidAmount) ||
    !isCanonicalMoney(value.outstandingBalance) ||
    !isCanonicalInstant(value.createdAt) ||
    !nullableInstant(value.paidAt) ||
    !Array.isArray(value.payments)
  ) {
    return null;
  }
  const payments = value.payments.map(parseHistory);
  if (payments.some((payment) => payment === null)) return null;
  return Object.freeze({
    id: value.id,
    status: value.status,
    totalAmount: value.totalAmount,
    paidAmount: value.paidAmount,
    outstandingBalance: value.outstandingBalance,
    createdAt: value.createdAt,
    paidAt: value.paidAt as string | null,
    payments: Object.freeze(payments),
  }) as PendingPaymentOrder["baskets"][number];
}

function parseHistory(value: unknown) {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isCanonicalMoney(value.amount) ||
    !isUuid(value.paymentMethodId) ||
    !isNonblank(value.paymentMethodCode) ||
    !isNonblank(value.paymentMethodName) ||
    !isRecord(value.recordedBy) ||
    !isUuid(value.recordedBy.id) ||
    !isNonblank(value.recordedBy.displayName) ||
    !isCanonicalInstant(value.recordedAt) ||
    !nullableText(value.referenceNumber) ||
    !nullableText(value.comments)
  ) {
    return null;
  }
  return Object.freeze({
    id: value.id,
    amount: value.amount,
    paymentMethodId: value.paymentMethodId,
    paymentMethodCode: value.paymentMethodCode,
    paymentMethodName: value.paymentMethodName,
    recordedBy: Object.freeze({
      id: value.recordedBy.id,
      displayName: value.recordedBy.displayName,
    }),
    recordedAt: value.recordedAt,
    referenceNumber: value.referenceNumber,
    comments: value.comments,
  });
}

function moneyToCents(value: string): bigint | null {
  return isCanonicalMoney(value) ? BigInt(value.replace(".", "")) : null;
}

function formatCents(value: bigint): string {
  const canonical = value.toString().padStart(3, "0");
  return `${canonical.slice(0, -2)}.${canonical.slice(-2)}`;
}

function isCanonicalMoney(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d{2}$/.test(value);
}

function isCanonicalInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function nullableInstant(value: unknown): value is string | null {
  return value === null || isCanonicalInstant(value);
}

function nullableText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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
