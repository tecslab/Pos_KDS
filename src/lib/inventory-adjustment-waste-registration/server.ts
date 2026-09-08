import "server-only";

import {
  InventoryAdjustmentWasteRegisteredRealtimePublisher,
  InventoryAdjustmentWasteRegistrationService,
  TransactionalOperationRunner,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseInventoryAdjustmentWasteRegistrationGateway,
  SupabaseInventoryAdjustmentWasteRegistrationTransactionBoundary,
} from "../../infrastructure/inventory";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createInventoryAdjustmentWasteRegistrationService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher();
  const realtimePublisher =
    new InventoryAdjustmentWasteRegisteredRealtimePublisher(
      new SupabaseRealtimePublisher(client),
    );

  dispatcher.subscribe("inventory.adjustment.registered", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );
  dispatcher.subscribe("inventory.waste.registered", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
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
