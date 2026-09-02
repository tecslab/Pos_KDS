import type { OrderOnTheWayError } from "../../application";

export type OrderOnTheWayHttpErrorDescriptor = Readonly<{
  status: 403 | 404 | 409 | 422 | 500;
  body: Readonly<{ error: Readonly<{ code: string; message: string }> }>;
}>;

function descriptor(
  status: OrderOnTheWayHttpErrorDescriptor["status"],
  code: string,
  message: string,
): OrderOnTheWayHttpErrorDescriptor {
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
  INVALID_ON_THE_WAY_TRANSITION: descriptor(
    422,
    "INVALID_ON_THE_WAY_TRANSITION",
    "The On-the-Way transition is invalid.",
  ),
  NOT_FOUND: descriptor(404, "NOT_FOUND", "The order was not found."),
  ORDER_NOT_READY: descriptor(
    409,
    "ORDER_NOT_READY",
    "Only a Ready order can be marked On the Way.",
  ),
  OPERATION_FAILED: descriptor(
    500,
    "INTERNAL_ERROR",
    "An unexpected error occurred.",
  ),
} satisfies Readonly<
  Record<OrderOnTheWayError["code"], OrderOnTheWayHttpErrorDescriptor>
>);

export function mapOrderOnTheWayErrorToHttp(
  error: unknown,
): OrderOnTheWayHttpErrorDescriptor {
  try {
    const code = readCode(error);
    return code === null ? descriptors.OPERATION_FAILED : descriptors[code];
  } catch {
    return descriptors.OPERATION_FAILED;
  }
}

function readCode(value: unknown): OrderOnTheWayError["code"] | null {
  if (!isPlainObject(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("kind") ||
    !keys.includes("code") ||
    value.kind !== "order-on-the-way-error"
  )
    return null;
  switch (value.code) {
    case "UNAUTHORIZED":
    case "INVALID_ON_THE_WAY_TRANSITION":
    case "NOT_FOUND":
    case "ORDER_NOT_READY":
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
