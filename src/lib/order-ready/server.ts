import "server-only";

import {
  OrderReadyRealtimePublisher,
  OrderReadyService,
  TransactionalOperationRunner,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseOrderReadyGateway,
  SupabaseOrderReadyTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createOrderReadyService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher();
  const realtimePublisher = new OrderReadyRealtimePublisher(
    new SupabaseRealtimePublisher(client),
  );

  dispatcher.subscribe("order.ready", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );

  return new OrderReadyService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseOrderReadyGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseOrderReadyTransactionBoundary(),
      dispatcher,
    ),
  );
}
