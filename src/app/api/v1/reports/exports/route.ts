import { authorizeApiPermission } from "../../../../../lib/auth/api-authorization";
import { createReportExportService } from "../../../../../lib/report-export/server";

export const runtime = "nodejs";

const supportedProperties = new Set([
  "restaurantId",
  "date",
  "timeZone",
  "format",
]);

export async function POST(request: Request) {
  try {
    const viewAuthorization = await authorizeApiPermission("reports.view");
    if (!viewAuthorization.ok) {
      return authorizationResponse(viewAuthorization.error.code);
    }

    const exportAuthorization = await authorizeApiPermission("reports.export");
    if (!exportAuthorization.ok) {
      return authorizationResponse(exportAuthorization.error.code);
    }
    if (exportAuthorization.value.userId !== viewAuthorization.value.userId) {
      return authorizationResponse("UNAUTHORIZED");
    }

    const input = await readInput(request);
    if (input === null) return invalidInput();

    const result = await createReportExportService().export({
      actorId: viewAuthorization.value.userId,
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

    return new Response(Buffer.from(result.value.bytes), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${result.value.filename}"`,
        "Content-Type": result.value.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return internalError();
  }
}

async function readInput(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length !== supportedProperties.size ||
    keys.some((key) => !supportedProperties.has(key))
  ) {
    return null;
  }
  return Object.freeze({
    restaurantId: input.restaurantId,
    date: input.date,
    timeZone: input.timeZone,
    format: input.format,
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
    "The report export parameters are invalid.",
  );
}

function internalError() {
  return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred.");
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
