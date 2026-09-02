import { authorizeApiPermission } from "../../../../../../../lib/auth/api-authorization";
import { mapOrderDeliveredErrorToHttp } from "../../../../../../../lib/http";
import { createOrderDeliveredService } from "../../../../../../../lib/order-delivered/server";

type RouteContext = Readonly<{ params: Promise<{ orderId: string }> }>;

export async function PATCH(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeApiPermission(
      "delivery.delivered.mark",
    );
    if (!authorization.ok)
      return authorizationResponse(authorization.error.code);

    const { orderId } = await context.params;
    const result = await createOrderDeliveredService().markDelivered(
      authorization.value.userId,
      { orderId, sourceIp: null },
    );
    if (!result.ok) {
      const response = mapOrderDeliveredErrorToHttp(result.error);
      return Response.json(response.body, { status: response.status });
    }

    return Response.json({
      orderId: result.value.orderId,
      status: result.value.status,
      deliveredById: result.value.deliveredById,
      deliveredAt: result.value.deliveredAt,
    });
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
