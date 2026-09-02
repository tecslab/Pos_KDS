import type { OrderDeliveredError } from "../../application";

export type OrderDeliveredHttpErrorDescriptor = Readonly<{
  status: 403 | 404 | 409 | 422 | 500;
  body: Readonly<{ error: Readonly<{ code: string; message: string }> }>;
}>;

function descriptor(
  status: OrderDeliveredHttpErrorDescriptor["status"],
  code: string,
  message: string,
): OrderDeliveredHttpErrorDescriptor {
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
  INVALID_DELIVERED_TRANSITION: descriptor(
    422,
    "INVALID_DELIVERED_TRANSITION",
    "The Delivered transition is invalid.",
  ),
  NOT_FOUND: descriptor(404, "NOT_FOUND", "The order was not found."),
  ORDER_NOT_ON_THE_WAY: descriptor(
    409,
    "ORDER_NOT_ON_THE_WAY",
    "Only an On-the-Way order can be marked Delivered.",
  ),
  OPERATION_FAILED: descriptor(
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred.",
  ),
} satisfies Readonly<
  Record<OrderDeliveredError["code"], OrderDeliveredHttpErrorDescriptor>
>);

export function mapOrderDeliveredErrorToHttp(
  error: unknown,
): OrderDeliveredHttpErrorDescriptor {
  try {
    const code = readCode(error);
    return code === null ? descriptors.OPERATION_FAILED : descriptors[code];
  } catch {
    return descriptors.OPERATION_FAILED;
  }
}

function readCode(value: unknown): OrderDeliveredError["code"] | null {
  if (!isPlainObject(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("kind") ||
    !keys.includes("code") ||
    value.kind !== "order-delivered-error"
  )
    return null;
  switch (value.code) {
    case "UNAUTHORIZED":
    case "INVALID_DELIVERED_TRANSITION":
    case "NOT_FOUND":
    case "ORDER_NOT_ON_THE_WAY":
    case "OPERATION_FAILED":
      return value.code;
    default:
      return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
