import { authorizeApiPermission } from "../../../../../lib/auth/api-authorization";
import { createKitchenQueueService } from "../../../../../lib/kitchen-queue/server";

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
    const authorization = await authorizeApiPermission("kitchen.queue.view");
    if (!authorization.ok) {
      const response = errorResponses[authorization.error.code];
      return Response.json(response.body, { status: response.status });
    }

    const result = await createKitchenQueueService().read();
    if (!result.ok) {
      const response = errorResponses.INTERNAL_ERROR;
      return Response.json(response.body, { status: response.status });
    }

    return Response.json({ orders: result.value });
  } catch {
    const response = errorResponses.INTERNAL_ERROR;
    return Response.json(response.body, { status: response.status });
  }
}
