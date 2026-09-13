import type { PaymentQueryFilterInput } from "../../../../../application";
import { authorizeApiPermission } from "../../../../../lib/auth/api-authorization";
import { createPaymentQueryService } from "../../../../../lib/payment-queries/server";
import { observeApiRoute } from "../../../../../lib/observability/api-route";

const supportedFilters = new Set(["serviceLocationId", "orderNumber"]);

async function handleGet(request: Request) {
  try {
    const authorization = await authorizeApiPermission("payments.view");
    if (!authorization.ok) {
      return authorizationResponse(authorization.error.code);
    }

    const filters = readFilters(request.url);
    if (filters === null) return invalidFilters();

    const result = await createPaymentQueryService().list(filters);
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

function readFilters(url: string): PaymentQueryFilterInput | null {
  const searchParams = new URL(url).searchParams;
  const keys = new Set<string>();
  for (const key of searchParams.keys()) {
    if (!supportedFilters.has(key) || keys.has(key)) return null;
    keys.add(key);
  }
  return {
    serviceLocationId: searchParams.get("serviceLocationId") ?? undefined,
    orderNumber: searchParams.get("orderNumber") ?? undefined,
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
    "The pending-payment filters are invalid.",
  );
}

function internalError() {
  return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export const GET = observeApiRoute("GET", handleGet);
