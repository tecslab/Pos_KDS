import "server-only";

import {
  InventoryAlertChangedRealtimePublisher,
  ProductionBatchCompletionService,
  ProductionCompletedRealtimePublisher,
  TransactionalOperationRunner,
} from "../../application";
import type { InventoryAlertChanged, ProductionCompleted } from "../../domain";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseProductionBatchCompletionGateway,
  SupabaseProductionBatchCompletionTransactionBoundary,
} from "../../infrastructure/production";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createProductionBatchCompletionService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher<
    ProductionCompleted | InventoryAlertChanged
  >();
  const productionPublisher = new ProductionCompletedRealtimePublisher(
    new SupabaseRealtimePublisher(client),
  );
  const inventoryAlertPublisher = new InventoryAlertChangedRealtimePublisher(
    new SupabaseRealtimePublisher(client),
  );

  dispatcher.subscribe("production.completed", (event) =>
    productionPublisher.publish(Object.freeze([event])),
  );
  dispatcher.subscribe("inventory.alert.changed", (event) =>
    inventoryAlertPublisher.publish(Object.freeze([event])),
  );

  return new ProductionBatchCompletionService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseProductionBatchCompletionGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseProductionBatchCompletionTransactionBoundary(),
      dispatcher,
    ),
  );
}
