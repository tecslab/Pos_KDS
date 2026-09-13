import "server-only";

import { randomUUID } from "node:crypto";

import {
  PrintingFacade,
  type ConfirmedOrder,
  type PrintRequest,
} from "../../application";
import { NoOpPrinterService } from "../../infrastructure/printing";
import { operationalTelemetry } from "../observability/recorder";

export interface KitchenTicketRequester {
  printAfterPersistence(request: PrintRequest): Promise<unknown>;
}

/**
 * Starts a kitchen-ticket attempt after the order transaction has committed.
 * This deliberately does not await printing: a printer failure must never
 * change an already-persisted order confirmation into a client failure.
 */
export function requestKitchenTicketAfterPersistence(
  order: ConfirmedOrder,
  requester?: KitchenTicketRequester,
): void {
  try {
    const ticketRequester = requester ?? createKitchenTicketRequester();
    void ticketRequester
      .printAfterPersistence(toKitchenTicketRequest(order))
      .catch(() => undefined);
  } catch {
    // Composition failures are also non-fatal after order persistence.
  }
}

export function toKitchenTicketRequest(order: ConfirmedOrder): PrintRequest {
  return Object.freeze({
    jobId: `kitchen-ticket:${order.orderId}`,
    attemptId: randomUUID(),
    attemptNumber: 1,
    restaurantId: order.restaurantId,
    logicalTarget: "kitchen:default",
    document: Object.freeze({
      id: order.orderId,
      type: "KITCHEN_TICKET",
      lines: Object.freeze([
        Object.freeze({
          text: `Orden ${order.orderNumber}`,
          emphasized: true,
          alignment: "CENTER",
        }),
        ...order.baskets.flatMap((basket) =>
          basket.lines.flatMap((line) => [
            Object.freeze({
              text: `${line.quantity} × ${line.productName}`,
              emphasized: true,
            }),
            ...line.selectedOptions.map((option) =>
              Object.freeze({ text: `+ ${option.name}` }),
            ),
            ...line.removedIngredients.map((ingredient) =>
              Object.freeze({ text: `Sin ${ingredient.name}` }),
            ),
            ...(line.observations === null
              ? []
              : [Object.freeze({ text: line.observations })]),
          ]),
        ),
      ]),
    }),
  });
}

function createKitchenTicketRequester(): KitchenTicketRequester {
  return new PrintingFacade(
    {
      async select() {
        return { status: "selected", destination: { id: "kitchen:default" } };
      },
    },
    new NoOpPrinterService({ log() {} }),
    {
      async decide() {
        return { action: "STOP" };
      },
    },
    { async report() {} },
    operationalTelemetry,
  );
}
