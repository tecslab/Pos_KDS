import { err, ok, type Result } from "../../domain";

const MAXIMUM_WAITING_MINUTES = 24 * 60;

export type DeliveryQueueFilterInput = Readonly<{
  serviceLocationId?: string;
  orderNumber?: string;
  minimumWaitingMinutes?: string;
}>;

export type DeliveryQueueFilters = Readonly<{
  serviceLocationId: string | null;
  orderNumber: string | null;
  minimumWaitingMinutes: number | null;
  readyAtBeforeOrEqual: string | null;
}>;

export type DeliveryQueueServiceLocation = Readonly<{
  id: string;
  name: string;
  type: string;
}>;

export type DeliveryQueueLine = Readonly<{
  id: string;
  quantity: number;
  observations: string | null;
}>;

export type DeliveryQueueOrder = Readonly<{
  id: string;
  restaurantId: string;
  orderNumber: string;
  status: "READY";
  serviceLocation: DeliveryQueueServiceLocation;
  notes: string | null;
  createdAt: string;
  readyAt: string;
  lines: readonly DeliveryQueueLine[];
}>;

export type DeliveryQueueItem = Readonly<{
  id: string;
  orderNumber: string;
  status: "READY";
  serviceLocation: DeliveryQueueServiceLocation;
  createdAt: string;
  readyAt: string;
  waitingTimeSeconds: number;
  productCount: number;
  specialObservations: readonly string[];
}>;

export interface DeliveryQueueReader {
  readReady(
    filters: DeliveryQueueFilters,
  ): Promise<readonly DeliveryQueueOrder[]>;
}

export type DeliveryQueueError = Readonly<{
  kind: "delivery-queue-error";
  code: "INVALID_FILTERS" | "OPERATION_FAILED";
}>;

export class DeliveryQueueService {
  constructor(
    private readonly reader: DeliveryQueueReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(
    input: DeliveryQueueFilterInput,
  ): Promise<Result<readonly DeliveryQueueItem[], DeliveryQueueError>> {
    const now = this.now();
    const filters = parseDeliveryQueueFilters(input, now);
    if (filters === null) return failure("INVALID_FILTERS");

    try {
      const orders = await this.reader.readReady(filters);
      const nowMilliseconds = now.getTime();

      const items = orders.map((order) => projectOrder(order, nowMilliseconds));
      return ok(
        Object.freeze(
          items.sort(
            (left, right) =>
              left.readyAt.localeCompare(right.readyAt) ||
              left.id.localeCompare(right.id),
          ),
        ),
      );
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

export function parseDeliveryQueueFilters(
  input: DeliveryQueueFilterInput,
  now: Date,
): DeliveryQueueFilters | null {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return null;

  const serviceLocationId = optionalUuid(input.serviceLocationId);
  const orderNumber = optionalOrderNumber(input.orderNumber);
  const minimumWaitingMinutes = optionalWaitingMinutes(
    input.minimumWaitingMinutes,
  );
  if (
    serviceLocationId === undefined ||
    orderNumber === undefined ||
    minimumWaitingMinutes === undefined
  ) {
    return null;
  }

  const readyAtBeforeOrEqual =
    minimumWaitingMinutes === null
      ? null
      : new Date(
          now.getTime() - minimumWaitingMinutes * 60 * 1000,
        ).toISOString();

  return Object.freeze({
    serviceLocationId,
    orderNumber,
    minimumWaitingMinutes,
    readyAtBeforeOrEqual,
  });
}

function projectOrder(
  order: DeliveryQueueOrder,
  nowMilliseconds: number,
): DeliveryQueueItem {
  const createdAt = timestamp(order.createdAt);
  const readyAt = timestamp(order.readyAt);
  const readyMilliseconds = Date.parse(readyAt);
  if (
    order.status !== "READY" ||
    readyMilliseconds > nowMilliseconds ||
    !isNonblank(order.id) ||
    !isNonblank(order.orderNumber) ||
    !validLocation(order.serviceLocation) ||
    (order.notes !== null && typeof order.notes !== "string") ||
    !Array.isArray(order.lines)
  ) {
    throw new Error();
  }

  let productCount = 0;
  const observations: string[] = order.notes?.trim() ? [order.notes] : [];
  for (const line of order.lines) {
    if (
      !isNonblank(line.id) ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      (line.observations !== null && typeof line.observations !== "string")
    ) {
      throw new Error();
    }
    productCount += line.quantity;
    if (!Number.isSafeInteger(productCount)) throw new Error();
    if (line.observations?.trim()) observations.push(line.observations);
  }
  if (productCount === 0) throw new Error();

  return Object.freeze({
    id: order.id,
    orderNumber: order.orderNumber,
    status: "READY",
    serviceLocation: Object.freeze({ ...order.serviceLocation }),
    createdAt,
    readyAt,
    waitingTimeSeconds: Math.floor(
      (nowMilliseconds - readyMilliseconds) / 1000,
    ),
    productCount,
    specialObservations: Object.freeze(observations),
  });
}

function optionalUuid(value: string | undefined): string | null | undefined {
  if (value === undefined) return null;
  return isUuid(value) ? value : undefined;
}

function optionalOrderNumber(
  value: string | undefined,
): string | null | undefined {
  if (value === undefined) return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 100
    ? normalized
    : undefined;
}

function optionalWaitingMinutes(
  value: string | undefined,
): number | null | undefined {
  if (value === undefined) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAXIMUM_WAITING_MINUTES
    ? parsed
    : undefined;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") throw new Error();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error();
  return new Date(milliseconds).toISOString();
}

function validLocation(value: DeliveryQueueServiceLocation) {
  return isUuid(value.id) && isNonblank(value.name) && isNonblank(value.type);
}

function isNonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function failure(code: DeliveryQueueError["code"]) {
  return err(
    Object.freeze({
      kind: "delivery-queue-error" as const,
      code,
    }),
  );
}
