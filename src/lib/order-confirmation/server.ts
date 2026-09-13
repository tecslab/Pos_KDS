import "server-only";

import {
  InventoryAlertChangedRealtimePublisher,
  OrderConfirmationService,
  OrderConfirmedRealtimePublisher,
  TransactionalOperationRunner,
} from "../../application";
import type { InventoryAlertChanged, OrderConfirmed } from "../../domain";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseOrderConfirmationGateway,
  SupabaseOrderConfirmationTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";

export function createOrderConfirmationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher<
    OrderConfirmed | InventoryAlertChanged
  >(operationalTelemetry);
  const realtimePublisher = new OrderConfirmedRealtimePublisher(
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
  dispatcher.subscribe("order.confirmed", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );
  dispatcher.subscribe("inventory.alert.changed", (event) =>
    inventoryAlertPublisher.publish(Object.freeze([event])),
  );

  return new OrderConfirmationService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseOrderConfirmationGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseOrderConfirmationTransactionBoundary(),
      dispatcher,
    ),
  );
}
