const BUSINESS_ERROR_KIND = "business-error" as const;

export type InvalidTransitionError = Readonly<{
  kind: typeof BUSINESS_ERROR_KIND;
  code: "INVALID_TRANSITION";
}>;

export type InsufficientInventoryError = Readonly<{
  kind: typeof BUSINESS_ERROR_KIND;
  code: "INSUFFICIENT_INVENTORY";
}>;

export type InvalidPaymentError = Readonly<{
  kind: typeof BUSINESS_ERROR_KIND;
  code: "INVALID_PAYMENT";
}>;

export type UnauthorizedError = Readonly<{
  kind: typeof BUSINESS_ERROR_KIND;
  code: "UNAUTHORIZED";
}>;

export type BusinessError =
  | InvalidTransitionError
  | InsufficientInventoryError
  | InvalidPaymentError
  | UnauthorizedError;

export type BusinessErrorCode = BusinessError["code"];

const businessErrorCodes: ReadonlySet<string> = new Set<BusinessErrorCode>([
  "INVALID_TRANSITION",
  "INSUFFICIENT_INVENTORY",
  "INVALID_PAYMENT",
  "UNAUTHORIZED",
]);

function createBusinessError<C extends BusinessErrorCode>(
  code: C,
): Readonly<{ kind: typeof BUSINESS_ERROR_KIND; code: C }> {
  return Object.freeze({ kind: BUSINESS_ERROR_KIND, code });
}

export function invalidTransitionError(): InvalidTransitionError {
  return createBusinessError("INVALID_TRANSITION");
}

export function insufficientInventoryError(): InsufficientInventoryError {
  return createBusinessError("INSUFFICIENT_INVENTORY");
}

export function invalidPaymentError(): InvalidPaymentError {
  return createBusinessError("INVALID_PAYMENT");
}

export function unauthorizedError(): UnauthorizedError {
  return createBusinessError("UNAUTHORIZED");
}

export function isBusinessError(error: unknown): error is BusinessError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  try {
    const candidate = error as Record<PropertyKey, unknown>;
    const keys = Reflect.ownKeys(candidate);

    return (
      keys.length === 2 &&
      Object.hasOwn(candidate, "kind") &&
      Object.hasOwn(candidate, "code") &&
      candidate.kind === BUSINESS_ERROR_KIND &&
      typeof candidate.code === "string" &&
      businessErrorCodes.has(candidate.code)
    );
  } catch {
    return false;
  }
}
