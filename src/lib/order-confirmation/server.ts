import "server-only";

import {
  OrderConfirmationService,
  OrderConfirmedRealtimePublisher,
  TransactionalOperationRunner,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import {
  SupabaseOrderConfirmationGateway,
  SupabaseOrderConfirmationTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createOrderConfirmationService() {
  const client = createSupabaseAdminClient();
  const realtimePublisher = new OrderConfirmedRealtimePublisher(
    new SupabaseRealtimePublisher(client),
  );

  return new OrderConfirmationService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseOrderConfirmationGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseOrderConfirmationTransactionBoundary(),
      realtimePublisher,
    ),
  );
}
