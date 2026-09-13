import "server-only";

import {
  InventoryAlertChangedRealtimePublisher,
  InventoryAdjustmentWasteRegisteredRealtimePublisher,
  InventoryAdjustmentWasteRegistrationService,
  TransactionalOperationRunner,
} from "../../application";
import type {
  InventoryAdjustmentWasteRegistered,
  InventoryAlertChanged,
} from "../../domain";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseInventoryAdjustmentWasteRegistrationGateway,
  SupabaseInventoryAdjustmentWasteRegistrationTransactionBoundary,
} from "../../infrastructure/inventory";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";

export function createInventoryAdjustmentWasteRegistrationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher<
    InventoryAdjustmentWasteRegistered | InventoryAlertChanged
  >(operationalTelemetry);
  const realtimePublisher =
    new InventoryAdjustmentWasteRegisteredRealtimePublisher(
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

  dispatcher.subscribe("inventory.adjustment.registered", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );
  dispatcher.subscribe("inventory.waste.registered", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );
  dispatcher.subscribe("inventory.alert.changed", (event) =>
    inventoryAlertPublisher.publish(Object.freeze([event])),
  );

  return new InventoryAdjustmentWasteRegistrationService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseInventoryAdjustmentWasteRegistrationGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseInventoryAdjustmentWasteRegistrationTransactionBoundary(),
      dispatcher,
    ),
  );
}
