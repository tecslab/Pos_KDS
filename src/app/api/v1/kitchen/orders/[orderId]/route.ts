import { authorizeApiPermission } from "../../../../../../lib/auth/api-authorization";
import { mapOrderReadyErrorToHttp } from "../../../../../../lib/http";
import { createOrderReadyService } from "../../../../../../lib/order-ready/server";
import { observeApiRoute } from "../../../../../../lib/observability/api-route";

type RouteContext = Readonly<{ params: Promise<{ orderId: string }> }>;

async function handlePatch(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorizeApiPermission("kitchen.ready.mark");
    if (!authorization.ok)
      return authorizationResponse(authorization.error.code);

    const { orderId } = await context.params;
    const result = await createOrderReadyService().markReady(
      authorization.value.userId,
      { orderId, sourceIp: null },
    );
    if (!result.ok) {
      const response = mapOrderReadyErrorToHttp(result.error);
      return Response.json(response.body, { status: response.status });
    }

    return Response.json({
      orderId: result.value.orderId,
      status: result.value.status,
      readyAt: result.value.readyAt,
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
