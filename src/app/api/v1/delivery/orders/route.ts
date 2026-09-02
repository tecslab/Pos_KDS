import type { DeliveryQueueFilterInput } from "../../../../../application";
import { authorizeApiPermission } from "../../../../../lib/auth/api-authorization";
import { createDeliveryQueueService } from "../../../../../lib/delivery-queue/server";

const supportedFilters = new Set([
  "serviceLocationId",
  "orderNumber",
  "minimumWaitingMinutes",
]);

export async function GET(request: Request) {
  try {
    const authorization = await authorizeApiPermission("delivery.panel.view");
    if (!authorization.ok)
      return authorizationResponse(authorization.error.code);

    const filters = readFilters(request.url);
    if (filters === null) return invalidFilters();

    const result = await createDeliveryQueueService().read(filters);
    if (!result.ok) {
      return result.error.code === "INVALID_FILTERS"
        ? invalidFilters()
        : internalError();
    }

    return Response.json({ orders: result.value });
  } catch {
    return internalError();
  }
}

function readFilters(url: string): DeliveryQueueFilterInput | null {
  const searchParams = new URL(url).searchParams;
  const keys = new Set<string>();
  for (const key of searchParams.keys()) {
    if (!supportedFilters.has(key) || keys.has(key)) return null;
    keys.add(key);
  }

  return {
    serviceLocationId: searchParams.get("serviceLocationId") ?? undefined,
    orderNumber: searchParams.get("orderNumber") ?? undefined,
    minimumWaitingMinutes:
      searchParams.get("minimumWaitingMinutes") ?? undefined,
  };
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

function invalidFilters() {
  return errorResponse(
    400,
    "INVALID_FILTERS",
    "The delivery queue filters are invalid.",
  );
}

function internalError() {
  return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}
