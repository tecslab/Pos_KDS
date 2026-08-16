import { isBusinessError, type BusinessError } from "../../domain";

export type HttpErrorCode = BusinessError["code"] | "INTERNAL_ERROR";

export type HttpErrorDescriptor = Readonly<{
  status: 403 | 409 | 422 | 500;
  body: Readonly<{
    error: Readonly<{
      code: HttpErrorCode;
      message: string;
    }>;
  }>;
}>;

function descriptor(
  status: HttpErrorDescriptor["status"],
  code: HttpErrorCode,
  message: string,
): HttpErrorDescriptor {
  return Object.freeze({
    status,
    body: Object.freeze({
      error: Object.freeze({ code, message }),
    }),
  });
}

const invalidTransitionDescriptor = descriptor(
  409,
  "INVALID_TRANSITION",
  "The requested operation is not valid in the current state.",
);

const insufficientInventoryDescriptor = descriptor(
  409,
  "INSUFFICIENT_INVENTORY",
  "There is not enough inventory to complete the requested operation.",
);

const invalidPaymentDescriptor = descriptor(
  422,
  "INVALID_PAYMENT",
  "The payment amount is invalid.",
);

const unauthorizedDescriptor = descriptor(
  403,
  "UNAUTHORIZED",
  "You are not authorized to perform this operation.",
);

const internalErrorDescriptor = descriptor(
  500,
  "INTERNAL_ERROR",
  "An unexpected error occurred.",
);

export function mapErrorToHttp(error: unknown): HttpErrorDescriptor {
  if (!isBusinessError(error)) {
    return internalErrorDescriptor;
  }

  switch (error.code) {
    case "INVALID_TRANSITION":
      return invalidTransitionDescriptor;
    case "INSUFFICIENT_INVENTORY":
      return insufficientInventoryDescriptor;
    case "INVALID_PAYMENT":
      return invalidPaymentDescriptor;
    case "UNAUTHORIZED":
      return unauthorizedDescriptor;
    default:
      return assertNever(error);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled business error: ${String(value)}`);
}
