import type { PaymentRegistrationError } from "../../application";

export type PaymentRegistrationHttpErrorDescriptor = Readonly<{
  status: 403 | 404 | 409 | 422 | 500;
  body: Readonly<{ error: Readonly<{ code: string; message: string }> }>;
}>;

function descriptor(
  status: PaymentRegistrationHttpErrorDescriptor["status"],
  code: string,
  message: string,
): PaymentRegistrationHttpErrorDescriptor {
  return Object.freeze({
    status,
    body: Object.freeze({ error: Object.freeze({ code, message }) }),
  });
}

const descriptors = Object.freeze({
  UNAUTHORIZED: descriptor(
    403,
    "UNAUTHORIZED",
    "You are not authorized to perform this operation.",
  ),
  INVALID_PAYMENT: descriptor(
    422,
    "INVALID_PAYMENT",
    "The payment is invalid.",
  ),
  NOT_FOUND: descriptor(
    404,
    "NOT_FOUND",
    "The payment basket or order was not found.",
  ),
  ORDER_NOT_DELIVERED: descriptor(
    409,
    "ORDER_NOT_DELIVERED",
    "Only a delivered order can accept payments.",
  ),
  BASKET_ALREADY_PAID: descriptor(
    409,
    "BASKET_ALREADY_PAID",
    "The selected basket is already paid.",
  ),
  PAYMENT_METHOD_UNAVAILABLE: descriptor(
    409,
    "PAYMENT_METHOD_UNAVAILABLE",
    "The selected payment method is unavailable.",
  ),
  OVERAGE_NOT_AUTHORIZED: descriptor(
    403,
    "OVERAGE_NOT_AUTHORIZED",
    "You are not authorized to approve a payment overage.",
  ),
  OVERAGE_REASON_REQUIRED: descriptor(
    422,
    "OVERAGE_REASON_REQUIRED",
    "A reason is required to approve a payment overage.",
  ),
  OPERATION_FAILED: descriptor(
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred.",
  ),
} satisfies Readonly<
  Record<
    PaymentRegistrationError["code"],
    PaymentRegistrationHttpErrorDescriptor
  >
>);

export function mapPaymentRegistrationErrorToHttp(
  error: unknown,
): PaymentRegistrationHttpErrorDescriptor {
  try {
    const code = readCode(error);
    return code === null ? descriptors.OPERATION_FAILED : descriptors[code];
  } catch {
    return descriptors.OPERATION_FAILED;
  }
}

function readCode(value: unknown): PaymentRegistrationError["code"] | null {
  if (!isPlainObject(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("kind") ||
    !keys.includes("code") ||
    value.kind !== "payment-registration-error"
  ) {
    return null;
  }
  switch (value.code) {
    case "UNAUTHORIZED":
    case "INVALID_PAYMENT":
    case "NOT_FOUND":
    case "ORDER_NOT_DELIVERED":
    case "BASKET_ALREADY_PAID":
    case "PAYMENT_METHOD_UNAVAILABLE":
    case "OVERAGE_NOT_AUTHORIZED":
    case "OVERAGE_REASON_REQUIRED":
    case "OPERATION_FAILED":
      return value.code;
    default:
      return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
