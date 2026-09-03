import type { RegisterPaymentInput } from "../../../../application";
import { authorizeApiPermission } from "../../../../lib/auth/api-authorization";
import { mapPaymentRegistrationErrorToHttp } from "../../../../lib/http";
import { createPaymentRegistrationService } from "../../../../lib/payment-registration/server";

export async function POST(request: Request) {
  try {
    const authorization = await authorizeApiPermission("payments.register");
    if (!authorization.ok) {
      return authorizationResponse(authorization.error.code);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(
        400,
        "INVALID_REQUEST",
        "The request body must be valid JSON.",
      );
    }

    const result = await createPaymentRegistrationService().register(
      authorization.value.userId,
      toPublicPayment(body),
    );
    if (!result.ok) {
      const response = mapPaymentRegistrationErrorToHttp(result.error);
      return Response.json(response.body, { status: response.status });
    }
    return Response.json({ payment: result.value }, { status: 201 });
  } catch {
    return internalError();
  }
}

function toPublicPayment(value: unknown): RegisterPaymentInput {
  const source = isRecord(value) ? value : {};
  const payment: Record<string, unknown> = {
    basketId: source.basketId,
    paymentMethodId: source.paymentMethodId,
    amount: source.amount,
    sourceIp: null,
  };
  for (const optional of [
    "referenceNumber",
    "comments",
    "overageReason",
  ] as const) {
    if (Object.hasOwn(source, optional)) payment[optional] = source[optional];
  }
  return payment as RegisterPaymentInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
