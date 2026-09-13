import "server-only";

import {
  PaymentCompletedRealtimePublisher,
  PaymentRegistrationService,
  TransactionalOperationRunner,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabasePaymentRegistrationGateway,
  SupabasePaymentRegistrationTransactionBoundary,
} from "../../infrastructure/payments";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";

export function createPaymentRegistrationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher(operationalTelemetry);
  const realtimePublisher = new PaymentCompletedRealtimePublisher(
    new SupabaseRealtimePublisher(
      client,
      operationalTelemetry,
      operationalTelemetryClock,
    ),
  );

  dispatcher.subscribe("payment.completed", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );

  return new PaymentRegistrationService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabasePaymentRegistrationGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabasePaymentRegistrationTransactionBoundary(),
      dispatcher,
    ),
  );
}
