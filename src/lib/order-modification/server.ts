import "server-only";

import {
  OrderModificationService,
  OrderUpdatedRealtimePublisher,
  TransactionalOperationRunner,
} from "../../application";
import type { InventoryReconciled, OrderUpdated } from "../../domain";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseOrderModificationGateway,
  SupabaseOrderModificationTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createOrderModificationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher<
    OrderUpdated | InventoryReconciled
  >();
  const realtimePublisher = new OrderUpdatedRealtimePublisher(
    new SupabaseRealtimePublisher(client),
  );

  dispatcher.subscribe("order.updated", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );

  return new OrderModificationService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseOrderModificationGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseOrderModificationTransactionBoundary(),
      dispatcher,
    ),
  );
}
