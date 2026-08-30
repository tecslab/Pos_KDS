import type { OrderModificationError } from "../../application";

export type OrderModificationHttpErrorCode =
  | Exclude<OrderModificationError["code"], "OPERATION_FAILED">
  | "INTERNAL_ERROR";

export type OrderModificationHttpErrorDescriptor = Readonly<{
  status: 403 | 404 | 409 | 422 | 500;
  body: Readonly<{
    error: Readonly<{
      code: OrderModificationHttpErrorCode;
      message: string;
    }>;
  }>;
}>;

function descriptor(
  status: OrderModificationHttpErrorDescriptor["status"],
  code: OrderModificationHttpErrorCode,
  message: string,
): OrderModificationHttpErrorDescriptor {
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
  INVALID_MODIFICATION: descriptor(
    422,
    "INVALID_MODIFICATION",
    "The order modification is invalid.",
  ),
  NOT_FOUND: descriptor(404, "NOT_FOUND", "The order was not found."),
  ORDER_NOT_PENDING: descriptor(
    409,
    "ORDER_NOT_PENDING",
    "Only pending orders can be modified.",
  ),
  STALE_ORDER: descriptor(
    409,
    "STALE_ORDER",
    "The order has changed since it was loaded.",
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
  Record<OrderModificationError["code"], OrderModificationHttpErrorDescriptor>
>);

const internalErrorDescriptor = descriptors.OPERATION_FAILED;

export function mapOrderModificationErrorToHttp(
  error: unknown,
): OrderModificationHttpErrorDescriptor {
  try {
    const code = readOrderModificationErrorCode(error);
    return code === null ? internalErrorDescriptor : descriptors[code];
  } catch {
    return internalErrorDescriptor;
  }
}

function readOrderModificationErrorCode(
  value: unknown,
): OrderModificationError["code"] | null {
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

  if (value.kind !== "order-modification-error") return null;

  switch (value.code) {
    case "UNAUTHORIZED":
    case "INVALID_MODIFICATION":
    case "NOT_FOUND":
    case "ORDER_NOT_PENDING":
    case "STALE_ORDER":
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
