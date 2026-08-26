import { authorizeApiPermission } from "../../../../../lib/auth/api-authorization";
import { createPosOrderingContextService } from "../../../../../lib/pos-ordering-context/server";

const errorResponses = Object.freeze({
  AUTHENTICATION_REQUIRED: Object.freeze({
    status: 401,
    body: Object.freeze({
      error: Object.freeze({
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication is required.",
      }),
    }),
  }),
  UNAUTHORIZED: Object.freeze({
    status: 403,
    body: Object.freeze({
      error: Object.freeze({
        code: "UNAUTHORIZED",
        message: "You are not authorized to perform this operation.",
      }),
    }),
  }),
  INTERNAL_ERROR: Object.freeze({
    status: 500,
    body: Object.freeze({
      error: Object.freeze({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      }),
    }),
  }),
});

export async function GET() {
  try {
    const authorization = await authorizeApiPermission("orders.create");
    if (!authorization.ok) {
      const response = errorResponses[authorization.error.code];
      return Response.json(response.body, { status: response.status });
    }

    const result = await createPosOrderingContextService().read();
    if (!result.ok) {
      const response = errorResponses.INTERNAL_ERROR;
      return Response.json(response.body, { status: response.status });
    }

    return Response.json(result.value);
  } catch {
    const response = errorResponses.INTERNAL_ERROR;
    return Response.json(response.body, { status: response.status });
  }
}
