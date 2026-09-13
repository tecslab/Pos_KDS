import "server-only";

import {
  InventoryAlertChangedRealtimePublisher,
  OrderModificationService,
  OrderUpdatedRealtimePublisher,
  TransactionalOperationRunner,
} from "../../application";
import type {
  InventoryAlertChanged,
  InventoryReconciled,
  OrderUpdated,
} from "../../domain";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseOrderModificationGateway,
  SupabaseOrderModificationTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";

export function createOrderModificationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher<
    OrderUpdated | InventoryReconciled | InventoryAlertChanged
  >(operationalTelemetry);
  const realtimePublisher = new OrderUpdatedRealtimePublisher(
    new SupabaseRealtimePublisher(
      client,
      operationalTelemetry,
      operationalTelemetryClock,
    ),
  );
  const inventoryAlertPublisher = new InventoryAlertChangedRealtimePublisher(
    new SupabaseRealtimePublisher(
      client,
      operationalTelemetry,
      operationalTelemetryClock,
    ),
  );

  dispatcher.subscribe("order.updated", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );
  dispatcher.subscribe("inventory.alert.changed", (event) =>
    inventoryAlertPublisher.publish(Object.freeze([event])),
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
