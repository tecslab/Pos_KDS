import type { OrderCancellationError } from "../../application";

export type OrderCancellationHttpErrorCode =
  | Exclude<OrderCancellationError["code"], "OPERATION_FAILED">
  | "INTERNAL_ERROR";

export type OrderCancellationHttpErrorDescriptor = Readonly<{
  status: 403 | 404 | 409 | 422 | 500;
  body: Readonly<{
    error: Readonly<{
      code: OrderCancellationHttpErrorCode;
      message: string;
    }>;
  }>;
}>;

function descriptor(
  status: OrderCancellationHttpErrorDescriptor["status"],
  code: OrderCancellationHttpErrorCode,
  message: string,
): OrderCancellationHttpErrorDescriptor {
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
  INVALID_CANCELLATION: descriptor(
    422,
    "INVALID_CANCELLATION",
    "The order cancellation is invalid.",
  ),
  NOT_FOUND: descriptor(404, "NOT_FOUND", "The order was not found."),
  ORDER_NOT_CANCELLABLE: descriptor(
    409,
    "ORDER_NOT_CANCELLABLE",
    "Only pending or ready orders can be cancelled.",
  ),
  OPERATION_FAILED: descriptor(
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred.",
  ),
} satisfies Readonly<
  Record<OrderCancellationError["code"], OrderCancellationHttpErrorDescriptor>
>);

const internalErrorDescriptor = descriptors.OPERATION_FAILED;

export function mapOrderCancellationErrorToHttp(
  error: unknown,
): OrderCancellationHttpErrorDescriptor {
  try {
    const code = readOrderCancellationErrorCode(error);
    return code === null ? internalErrorDescriptor : descriptors[code];
  } catch {
    return internalErrorDescriptor;
  }
}

function readOrderCancellationErrorCode(
  value: unknown,
): OrderCancellationError["code"] | null {
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

  if (value.kind !== "order-cancellation-error") return null;

  switch (value.code) {
    case "UNAUTHORIZED":
    case "INVALID_CANCELLATION":
    case "NOT_FOUND":
    case "ORDER_NOT_CANCELLABLE":
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
