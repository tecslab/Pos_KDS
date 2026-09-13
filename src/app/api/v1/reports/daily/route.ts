import { authorizeApiPermission } from "../../../../../lib/auth/api-authorization";
import { createDailySalesReportService } from "../../../../../lib/daily-sales-report/server";
import { observeApiRoute } from "../../../../../lib/observability/api-route";

const supportedParameters = new Set(["restaurantId", "date", "timeZone"]);

async function handleGet(request: Request) {
  try {
    const authorization = await authorizeApiPermission("reports.view");
    if (!authorization.ok) {
      return authorizationResponse(authorization.error.code);
    }

    const input = readInput(request.url);
    if (input === null) return invalidInput();
    const result = await createDailySalesReportService().read({
      actorId: authorization.value.userId,
      ...input,
    });
    if (!result.ok) {
      if (result.error.code === "INVALID_INPUT") return invalidInput();
      if (result.error.code === "RESTAURANT_NOT_FOUND") {
        return errorResponse(
          404,
          "RESTAURANT_NOT_FOUND",
          "Restaurant not found.",
        );
      }
      if (result.error.code === "UNAUTHORIZED") {
        return authorizationResponse("UNAUTHORIZED");
      }
      return internalError();
    }
    return Response.json({ report: result.value });
  } catch {
    return internalError();
  }
}

function readInput(url: string) {
  const searchParams = new URL(url).searchParams;
  const seen = new Set<string>();
  for (const key of searchParams.keys()) {
    if (!supportedParameters.has(key) || seen.has(key)) return null;
    seen.add(key);
  }
  if (seen.size !== supportedParameters.size) return null;
  return Object.freeze({
    restaurantId: searchParams.get("restaurantId"),
    date: searchParams.get("date"),
    timeZone: searchParams.get("timeZone"),
  });
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

function invalidInput() {
  return errorResponse(
    400,
    "INVALID_INPUT",
    "The daily sales report parameters are invalid.",
  );
}

function internalError() {
  return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export const GET = observeApiRoute("GET", handleGet);
