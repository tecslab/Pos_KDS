import "server-only";

import { randomUUID } from "node:crypto";

import {
  PaymentReceiptService,
  paymentReceiptPreparationFailure,
  type PaymentReceiptDispatchOutcome,
  type RegisteredPayment,
} from "../../application";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import {
  NoOpPrinterService,
  type PrintMetadataLogger,
} from "../../infrastructure/printing";
import { SupabasePaymentReceiptSnapshotReader } from "../../infrastructure/payments";
import { createSupabaseAdminClient } from "../supabase/admin";

export async function dispatchPaymentReceiptAfterPersistence(
  actorId: string,
  payment: RegisteredPayment,
): Promise<PaymentReceiptDispatchOutcome> {
  try {
    return await createPaymentReceiptService().dispatch(actorId, payment);
  } catch {
    return paymentReceiptPreparationFailure(payment.paymentId);
  }
}

export function createPaymentReceiptService(
  metadataLogger: PrintMetadataLogger = { log() {} },
) {
  const client = createSupabaseAdminClient();
  return new PaymentReceiptService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabasePaymentReceiptSnapshotReader(client),
    new NoOpPrinterService(metadataLogger),
    {
      async decide(request, failure) {
        return failure.retryable && request.attemptNumber < 3
          ? {
              action: "RETRY" as const,
              nextAttemptNumber: request.attemptNumber + 1,
            }
          : { action: "STOP" as const };
      },
    },
    { async report() {} },
    randomUUID,
  );
}
