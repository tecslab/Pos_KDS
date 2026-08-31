import "server-only";

import {
  OrderCancellationService,
  OrderCancelledRealtimePublisher,
  TransactionalOperationRunner,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseOrderCancellationGateway,
  SupabaseOrderCancellationTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createOrderCancellationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher();
  const realtimePublisher = new OrderCancelledRealtimePublisher(
    new SupabaseRealtimePublisher(client),
  );

  dispatcher.subscribe("order.cancelled", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );

  return new OrderCancellationService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseOrderCancellationGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseOrderCancellationTransactionBoundary(),
      dispatcher,
    ),
  );
}
