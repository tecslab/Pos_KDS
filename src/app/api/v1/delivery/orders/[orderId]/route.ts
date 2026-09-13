import { authorizeApiPermission } from "../../../../../../lib/auth/api-authorization";
import { mapOrderOnTheWayErrorToHttp } from "../../../../../../lib/http";
import { createOrderOnTheWayService } from "../../../../../../lib/order-on-the-way/server";
import { observeApiRoute } from "../../../../../../lib/observability/api-route";

type RouteContext = Readonly<{ params: Promise<{ orderId: string }> }>;

async function handlePatch(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeApiPermission(
      "delivery.on_the_way.mark",
    );
    if (!authorization.ok)
      return authorizationResponse(authorization.error.code);

    const { orderId } = await context.params;
    const result = await createOrderOnTheWayService().markOnTheWay(
      authorization.value.userId,
      { orderId, sourceIp: null },
    );
    if (!result.ok) {
      const response = mapOrderOnTheWayErrorToHttp(result.error);
      return Response.json(response.body, { status: response.status });
    }

    return Response.json({
      orderId: result.value.orderId,
      status: result.value.status,
      collectedById: result.value.collectedById,
      onTheWayAt: result.value.onTheWayAt,
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

export const PATCH = observeApiRoute("PATCH", handlePatch);
