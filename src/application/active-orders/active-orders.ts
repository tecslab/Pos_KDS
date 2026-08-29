import { err, ok, type Result } from "../../domain";

export const ACTIVE_ORDER_STATUSES = Object.freeze([
  "PENDING",
  "READY",
  "ON_THE_WAY",
  "DELIVERED",
] as const);

export type ActiveOrderStatus = (typeof ACTIVE_ORDER_STATUSES)[number];
export type ActiveOrderBasketStatus = "PENDING" | "PAID";

export type ActiveOrderServiceLocation = Readonly<{
  id: string;
  name: string;
  type: string;
}>;

export type ActiveOrderWaiter = Readonly<{
  id: string;
  displayName: string;
}>;

export type ActiveOrderModificationSnapshot = Readonly<{
  id: string;
  name: string;
  priceAdjustment: string | null;
}>;

export type ActiveOrderLineSnapshot = Readonly<{
  id: string;
  revisionNumber: number;
  productVersionId: string;
  productName: string;
  quantity: number;
  baseUnitPrice: string;
  finalUnitPrice: string;
  lineTotal: string;
  taxCode: string;
  taxName: string;
  taxRate: string;
  priceIncludesTax: boolean;
  selectedOptions: readonly ActiveOrderModificationSnapshot[];
  removedIngredients: readonly ActiveOrderModificationSnapshot[];
  observations: string | null;
  createdAt: string;
}>;

export type ActiveOrderLine = Readonly<{
  id: string;
  currentSnapshotId: string;
  createdAt: string;
  currentSnapshot: ActiveOrderLineSnapshot;
  snapshots: readonly ActiveOrderLineSnapshot[];
}>;

export type ActiveOrderBasketSummary = Readonly<{
  id: string;
  status: ActiveOrderBasketStatus;
  totalAmount: string;
  paidAmount: string;
  outstandingBalance: string;
  lineCount: number;
  createdAt: string;
  paidAt: string | null;
}>;

export type ActiveOrderBasket = ActiveOrderBasketSummary &
  Readonly<{
    lines: readonly ActiveOrderLine[];
  }>;

type ActiveOrderBase = Readonly<{
  id: string;
  restaurantId: string;
  orderNumber: string;
  serviceLocation: ActiveOrderServiceLocation;
  assignedWaiter: ActiveOrderWaiter;
  status: ActiveOrderStatus;
  notes: string | null;
  totalAmount: string;
  paidAmount: string;
  outstandingBalance: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ActiveOrderListItem = ActiveOrderBase &
  Readonly<{
    baskets: readonly ActiveOrderBasketSummary[];
  }>;

export type ActiveOrderDetail = ActiveOrderBase &
  Readonly<{
    readyAt: string | null;
    onTheWayAt: string | null;
    deliveredAt: string | null;
    paidAt: string | null;
    baskets: readonly ActiveOrderBasket[];
  }>;

export interface ActiveOrderReader {
  listByStatuses(
    statuses: readonly ActiveOrderStatus[],
  ): Promise<readonly ActiveOrderListItem[]>;
  findByIdAndStatuses(
    orderId: string,
    statuses: readonly ActiveOrderStatus[],
  ): Promise<ActiveOrderDetail | null>;
}

export type ActiveOrderQueryError = Readonly<{
  kind: "active-order-query-error";
  code: "INVALID_ORDER_ID" | "NOT_FOUND" | "OPERATION_FAILED";
}>;

export class ActiveOrderQueryService {
  constructor(private readonly reader: ActiveOrderReader) {}

  async list(): Promise<
    Result<readonly ActiveOrderListItem[], ActiveOrderQueryError>
  > {
    try {
      const orders = await this.reader.listByStatuses(ACTIVE_ORDER_STATUSES);
      if (orders.some((order) => !isActiveStatus(order.status))) {
        return failure("OPERATION_FAILED");
      }
      return ok(Object.freeze([...orders]));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async detail(
    orderId: string,
  ): Promise<Result<ActiveOrderDetail, ActiveOrderQueryError>> {
    if (!isUuid(orderId)) return failure("INVALID_ORDER_ID");

    try {
      const order = await this.reader.findByIdAndStatuses(
        orderId,
        ACTIVE_ORDER_STATUSES,
      );
      if (order === null) return failure("NOT_FOUND");
      if (order.id !== orderId || !isActiveStatus(order.status)) {
        return failure("OPERATION_FAILED");
      }
      return ok(order);
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

function isActiveStatus(value: string): value is ActiveOrderStatus {
  return (ACTIVE_ORDER_STATUSES as readonly string[]).includes(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function failure(code: ActiveOrderQueryError["code"]) {
  return err(
    Object.freeze({
      kind: "active-order-query-error" as const,
      code,
    }),
  );
}
