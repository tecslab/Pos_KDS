import "server-only";

import {
  InventoryAlertChangedRealtimePublisher,
  OrderCancellationService,
  OrderCancelledRealtimePublisher,
  TransactionalOperationRunner,
} from "../../application";
import type { InventoryAlertChanged, OrderCancelled } from "../../domain";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseOrderCancellationGateway,
  SupabaseOrderCancellationTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";

export function createOrderCancellationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher<
    OrderCancelled | InventoryAlertChanged
  >(operationalTelemetry);
  const realtimePublisher = new OrderCancelledRealtimePublisher(
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

  dispatcher.subscribe("order.cancelled", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );
  dispatcher.subscribe("inventory.alert.changed", (event) =>
    inventoryAlertPublisher.publish(Object.freeze([event])),
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
