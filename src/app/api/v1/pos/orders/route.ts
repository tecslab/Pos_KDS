import type {
  ConfirmOrderBasketInput,
  ConfirmOrderInput,
  ConfirmOrderLineInput,
} from "../../../../../application";
import { authorizeApiPermission } from "../../../../../lib/auth/api-authorization";
import { createActiveOrderQueryService } from "../../../../../lib/active-orders/server";
import { mapOrderConfirmationErrorToHttp } from "../../../../../lib/http";
import { createOrderConfirmationService } from "../../../../../lib/order-confirmation/server";
import { requestKitchenTicketAfterPersistence } from "../../../../../lib/printing/server";

const authenticationRequired = Object.freeze({
  status: 401,
  body: Object.freeze({
    error: Object.freeze({
      code: "AUTHENTICATION_REQUIRED",
      message: "Authentication is required.",
    }),
  }),
});

const unauthorized = Object.freeze({
  status: 403,
  body: Object.freeze({
    error: Object.freeze({
      code: "UNAUTHORIZED",
      message: "You are not authorized to perform this operation.",
    }),
  }),
});

const invalidRequest = Object.freeze({
  status: 400,
  body: Object.freeze({
    error: Object.freeze({
      code: "INVALID_REQUEST",
      message: "The request body must be valid JSON.",
    }),
  }),
});

const internalError = Object.freeze({
  status: 500,
  body: Object.freeze({
    error: Object.freeze({
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    }),
  }),
});

export async function GET() {
  try {
    const authorization = await authorizeApiPermission("orders.view");
    if (!authorization.ok) {
      const response =
        authorization.error.code === "AUTHENTICATION_REQUIRED"
          ? authenticationRequired
          : unauthorized;
      return Response.json(response.body, { status: response.status });
    }

    const result = await createActiveOrderQueryService().list();
    if (!result.ok) {
      return Response.json(internalError.body, {
        status: internalError.status,
      });
    }
    return Response.json({ orders: result.value });
  } catch {
    return Response.json(internalError.body, { status: internalError.status });
  }
}

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiPermission("orders.create");
    if (!authorization.ok) {
      const response =
        authorization.error.code === "AUTHENTICATION_REQUIRED"
          ? authenticationRequired
          : unauthorized;
      return Response.json(response.body, { status: response.status });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(invalidRequest.body, {
        status: invalidRequest.status,
      });
    }

    const result = await createOrderConfirmationService().confirm(
      authorization.value.userId,
      toPublicDraft(body),
    );

    if (!result.ok) {
      const response = mapOrderConfirmationErrorToHttp(result.error);
      return Response.json(response.body, { status: response.status });
    }

    try {
      requestKitchenTicketAfterPersistence(result.value);
    } catch {
      // Printing is best effort and cannot change persisted confirmation.
    }

    return Response.json(result.value, { status: 201 });
  } catch {
    return Response.json(internalError.body, { status: internalError.status });
  }
}

function toPublicDraft(value: unknown): ConfirmOrderInput {
  const source = isRecord(value) ? value : {};
  const draft: Record<string, unknown> = {
    serviceLocationId: source.serviceLocationId,
    sourceIp: null,
    baskets: Array.isArray(source.baskets)
      ? source.baskets.map(toPublicBasket)
      : source.baskets,
  };

  if (Object.hasOwn(source, "notes")) draft.notes = source.notes;
  return draft as ConfirmOrderInput;
}

function toPublicBasket(value: unknown): ConfirmOrderBasketInput {
  const source = isRecord(value) ? value : {};
  return {
    clientCorrelationId: source.clientCorrelationId as string,
    lines: (Array.isArray(source.lines)
      ? source.lines.map(toPublicLine)
      : source.lines) as readonly ConfirmOrderLineInput[],
  };
}

function toPublicLine(value: unknown): ConfirmOrderLineInput {
  const source = isRecord(value) ? value : {};
  const line: Record<string, unknown> = {
    clientCorrelationId: source.clientCorrelationId,
    productVersionId: source.productVersionId,
    quantity: source.quantity,
  };

  for (const optional of [
    "optionIds",
    "removableIngredientIds",
    "observations",
  ] as const) {
    if (Object.hasOwn(source, optional)) line[optional] = source[optional];
  }

  return line as ConfirmOrderLineInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
