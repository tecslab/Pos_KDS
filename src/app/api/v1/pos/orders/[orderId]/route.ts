import { authorizeApiPermission } from "../../../../../../lib/auth/api-authorization";
import { createActiveOrderQueryService } from "../../../../../../lib/active-orders/server";

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
