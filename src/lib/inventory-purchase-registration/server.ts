import "server-only";

import {
  InventoryAlertChangedRealtimePublisher,
  InventoryPurchaseRegisteredRealtimePublisher,
  InventoryPurchaseRegistrationService,
  TransactionalOperationRunner,
} from "../../application";
import type {
  InventoryAlertChanged,
  InventoryPurchaseRegistered,
} from "../../domain";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseInventoryPurchaseRegistrationGateway,
  SupabaseInventoryPurchaseRegistrationTransactionBoundary,
} from "../../infrastructure/inventory";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";

export function createInventoryPurchaseRegistrationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher<
    InventoryPurchaseRegistered | InventoryAlertChanged
  >(operationalTelemetry);
  const realtimePublisher = new InventoryPurchaseRegisteredRealtimePublisher(
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

  dispatcher.subscribe("inventory.purchase.registered", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );
  dispatcher.subscribe("inventory.alert.changed", (event) =>
    inventoryAlertPublisher.publish(Object.freeze([event])),
  );

  return new InventoryPurchaseRegistrationService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseInventoryPurchaseRegistrationGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseInventoryPurchaseRegistrationTransactionBoundary(),
      dispatcher,
    ),
  );
}
