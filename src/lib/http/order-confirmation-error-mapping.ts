import type { OrderConfirmationError } from "../../application";

export type OrderConfirmationHttpErrorCode =
  OrderConfirmationError["code"] | "INTERNAL_ERROR";

export type OrderConfirmationHttpErrorDescriptor = Readonly<{
  status: 403 | 409 | 422 | 500;
  body: Readonly<{
    error: Readonly<{
      code: OrderConfirmationHttpErrorCode;
      message: string;
    }>;
  }>;
}>;

function descriptor(
  status: OrderConfirmationHttpErrorDescriptor["status"],
  code: OrderConfirmationHttpErrorCode,
  message: string,
): OrderConfirmationHttpErrorDescriptor {
  return Object.freeze({
    status,
    body: Object.freeze({
      error: Object.freeze({ code, message }),
    }),
  });
}

const descriptors = Object.freeze({
  UNAUTHORIZED: descriptor(
    403,
    "UNAUTHORIZED",
    "You are not authorized to perform this operation.",
  ),
  INVALID_DRAFT: descriptor(
    422,
    "INVALID_DRAFT",
    "The order draft is invalid.",
  ),
  LOCATION_UNAVAILABLE: descriptor(
    409,
    "LOCATION_UNAVAILABLE",
    "The service location cannot accept this order.",
  ),
  STALE_CONFIGURATION: descriptor(
    409,
    "STALE_CONFIGURATION",
    "The order uses configuration that is no longer available.",
  ),
  INSUFFICIENT_INVENTORY: descriptor(
    409,
    "INSUFFICIENT_INVENTORY",
    "There is not enough inventory to complete the requested operation.",
  ),
  OPERATION_FAILED: descriptor(
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred.",
  ),
} satisfies Readonly<
  Record<OrderConfirmationError["code"], OrderConfirmationHttpErrorDescriptor>
>);

const internalErrorDescriptor = descriptors.OPERATION_FAILED;

export function mapOrderConfirmationErrorToHttp(
  error: unknown,
): OrderConfirmationHttpErrorDescriptor {
  try {
    const code = readOrderConfirmationErrorCode(error);
    return code === null ? internalErrorDescriptor : descriptors[code];
  } catch {
    return internalErrorDescriptor;
  }
}

function readOrderConfirmationErrorCode(
  value: unknown,
): OrderConfirmationError["code"] | null {
  if (!isPlainObject(value)) return null;

  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("kind") ||
    !keys.includes("code") ||
    !isEnumerableDataProperty(value, "kind") ||
    !isEnumerableDataProperty(value, "code")
  ) {
    return null;
  }

  if (value.kind !== "order-confirmation-error") return null;

  switch (value.code) {
    case "UNAUTHORIZED":
    case "INVALID_DRAFT":
    case "LOCATION_UNAVAILABLE":
    case "STALE_CONFIGURATION":
    case "INSUFFICIENT_INVENTORY":
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

function isEnumerableDataProperty(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property?.enumerable === true && "value" in property;
}
