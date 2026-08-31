import { authorizeApiPermission } from "../../../../../../lib/auth/api-authorization";
import { createActiveOrderQueryService } from "../../../../../../lib/active-orders/server";
import type {
  CancelOrderInput,
  ModifyOrderInput,
  OrderModificationOperationInput,
} from "../../../../../../application";
import {
  mapOrderCancellationErrorToHttp,
  mapOrderModificationErrorToHttp,
} from "../../../../../../lib/http";
import { createOrderCancellationService } from "../../../../../../lib/order-cancellation/server";
import { createOrderModificationService } from "../../../../../../lib/order-modification/server";

type RouteContext = Readonly<{ params: Promise<{ orderId: string }> }>;

export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeApiPermission("orders.view");
    if (!authorization.ok)
      return authorizationResponse(authorization.error.code);

    const { orderId } = await context.params;
    const result = await createActiveOrderQueryService().detail(orderId);
    if (!result.ok) {
      if (result.error.code === "INVALID_ORDER_ID") {
        return errorResponse(
          400,
          "INVALID_ORDER_ID",
          "The order identifier is invalid.",
        );
      }
      if (result.error.code === "NOT_FOUND") {
        return errorResponse(
          404,
          "ORDER_NOT_FOUND",
          "The active order was not found.",
        );
      }
      return internalError();
    }

    return Response.json(result.value);
  } catch {
    return internalError();
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeApiPermission("orders.edit");
    if (!authorization.ok)
      return authorizationResponse(authorization.error.code);

    const { orderId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "The request body must be valid JSON.",
      );
    }

    const result = await createOrderModificationService().modify(
      authorization.value.userId,
      toPublicModification(orderId, body),
    );
    if (!result.ok) {
      const response = mapOrderModificationErrorToHttp(result.error);
      return Response.json(response.body, { status: response.status });
    }

    return Response.json(result.value);
  } catch {
    return internalError();
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeApiPermission("orders.cancel");
    if (!authorization.ok)
      return authorizationResponse(authorization.error.code);

    const { orderId } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "The request body must be valid JSON.",
      );
    }

    const result = await createOrderCancellationService().cancel(
      authorization.value.userId,
      toPublicCancellation(orderId, body),
    );
    if (!result.ok) {
      const response = mapOrderCancellationErrorToHttp(result.error);
      return Response.json(response.body, { status: response.status });
    }

    return Response.json(result.value);
  } catch {
    return internalError();
  }
}

function toPublicCancellation(
  orderId: string,
  value: unknown,
): CancelOrderInput {
  const source = isRecord(value) ? value : {};
  return {
    orderId,
    reason: source.reason as string,
    sourceIp: null,
  };
}

function toPublicModification(
  orderId: string,
  value: unknown,
): ModifyOrderInput {
  const source = isRecord(value) ? value : {};
  return {
    orderId,
    expectedUpdatedAt: source.expectedUpdatedAt as string,
    sourceIp: null,
    operations: (Array.isArray(source.operations)
      ? source.operations.map(toPublicOperation)
      : source.operations) as readonly OrderModificationOperationInput[],
  };
}

function toPublicOperation(value: unknown): OrderModificationOperationInput {
  const source = isRecord(value) ? value : {};
  if (source.kind === "add") {
    const operation: Record<string, unknown> = {
      kind: "add",
      basketId: source.basketId,
      clientCorrelationId: source.clientCorrelationId,
      productVersionId: source.productVersionId,
      quantity: source.quantity,
    };
    copyConfiguration(source, operation);
    return operation as AddOperation;
  }
  if (source.kind === "replace") {
    const operation: Record<string, unknown> = {
      kind: "replace",
      lineId: source.lineId,
      expectedCurrentSnapshotId: source.expectedCurrentSnapshotId,
      quantity: source.quantity,
    };
    copyConfiguration(source, operation);
    return operation as ReplaceOperation;
  }
  return {
    kind: source.kind,
    lineId: source.lineId,
    expectedCurrentSnapshotId: source.expectedCurrentSnapshotId,
  } as OrderModificationOperationInput;
}

type AddOperation = Extract<OrderModificationOperationInput, { kind: "add" }>;
type ReplaceOperation = Extract<
  OrderModificationOperationInput,
  { kind: "replace" }
>;

function copyConfiguration(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
) {
  for (const optional of [
    "optionIds",
    "removableIngredientIds",
    "observations",
  ] as const) {
    if (Object.hasOwn(source, optional)) target[optional] = source[optional];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authorizationResponse(
  code: "AUTHENTICATION_REQUIRED" | "UNAUTHORIZED",
) {
  return code === "AUTHENTICATION_REQUIRED"
    ? errorResponse(401, code, "Authentication is required.")
    : errorResponse(
        403,
        code,
        "You are not authorized to perform this operation.",
      );
}

function internalError() {
  return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}
