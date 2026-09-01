import { err, ok, type Result } from "../../domain";

export type KitchenQueueModification = Readonly<{
  id: string;
  name: string;
}>;

export type KitchenQueueLine = Readonly<{
  id: string;
  productName: string;
  quantity: number;
  selectedOptions: readonly KitchenQueueModification[];
  removedIngredients: readonly KitchenQueueModification[];
  observations: string | null;
}>;

export type KitchenQueueServiceLocation = Readonly<{
  id: string;
  name: string;
  type: string;
}>;

export type KitchenQueueOrder = Readonly<{
  id: string;
  orderNumber: string;
  status: "PENDING";
  serviceLocation: KitchenQueueServiceLocation;
  createdAt: string;
  lines: readonly KitchenQueueLine[];
}>;

export interface KitchenQueueReader {
  readPending(): Promise<readonly KitchenQueueOrder[]>;
}

export type KitchenQueueError = Readonly<{
  kind: "kitchen-queue-error";
  code: "OPERATION_FAILED";
}>;

export class KitchenQueueService {
  constructor(private readonly reader: KitchenQueueReader) {}

  async read(): Promise<
    Result<readonly KitchenQueueOrder[], KitchenQueueError>
  > {
    try {
      const pending = await this.reader.readPending();
      if (
        pending.some(
          (order) =>
            order.status !== "PENDING" ||
            !Number.isFinite(Date.parse(order.createdAt)),
        )
      ) {
        return failure();
      }

      return ok(
        Object.freeze(
          pending
            .map(projectOrder)
            .sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            ),
        ),
      );
    } catch {
      return failure();
    }
  }
}

function projectOrder(order: KitchenQueueOrder): KitchenQueueOrder {
  return Object.freeze({
    id: order.id,
    orderNumber: order.orderNumber,
    status: "PENDING",
    serviceLocation: Object.freeze({
      id: order.serviceLocation.id,
      name: order.serviceLocation.name,
      type: order.serviceLocation.type,
    }),
    createdAt: order.createdAt,
    lines: Object.freeze(
      order.lines.map((line) =>
        Object.freeze({
          id: line.id,
          productName: line.productName,
          quantity: line.quantity,
          selectedOptions: projectModifications(line.selectedOptions),
          removedIngredients: projectModifications(line.removedIngredients),
          observations: line.observations,
        }),
      ),
    ),
  });
}

function projectModifications(
  modifications: readonly KitchenQueueModification[],
) {
  return Object.freeze(
    modifications.map(({ id, name }) => Object.freeze({ id, name })),
  );
}

function failure() {
  return err(
    Object.freeze({
      kind: "kitchen-queue-error" as const,
      code: "OPERATION_FAILED" as const,
    }),
  );
}
