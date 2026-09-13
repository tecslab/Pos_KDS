import "server-only";

import {
  OrderDeliveredRealtimePublisher,
  OrderDeliveredService,
  TransactionalOperationRunner,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseOrderDeliveredGateway,
  SupabaseOrderDeliveredTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";

export function createOrderDeliveredService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher(operationalTelemetry);
  const realtimePublisher = new OrderDeliveredRealtimePublisher(
    new SupabaseRealtimePublisher(
      client,
      operationalTelemetry,
      operationalTelemetryClock,
    ),
  );

  dispatcher.subscribe("order.delivered", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );

  return new OrderDeliveredService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseOrderDeliveredGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseOrderDeliveredTransactionBoundary(),
      dispatcher,
    ),
  );
}
