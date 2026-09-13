import { authorizeApiPermission } from "../../../../lib/auth/api-authorization";
import { createInventoryViewsService } from "../../../../lib/inventory-views/server";
import { observeApiRoute } from "../../../../lib/observability/api-route";

async function handleGet() {
  try {
    const authorization = await authorizeApiPermission("inventory.view");
    if (!authorization.ok)
      return authorizationResponse(authorization.error.code);

    const result = await createInventoryViewsService().list();
    if (!result.ok) return internalError();
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

export const GET = observeApiRoute("GET", handleGet);
