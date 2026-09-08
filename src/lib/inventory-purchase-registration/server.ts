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

export function createInventoryPurchaseRegistrationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher<
    InventoryPurchaseRegistered | InventoryAlertChanged
  >();
  const realtimePublisher = new InventoryPurchaseRegisteredRealtimePublisher(
    new SupabaseRealtimePublisher(client),
  );
  const inventoryAlertPublisher = new InventoryAlertChangedRealtimePublisher(
    new SupabaseRealtimePublisher(client),
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
