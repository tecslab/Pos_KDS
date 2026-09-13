import "server-only";

import {
  OrderOnTheWayRealtimePublisher,
  OrderOnTheWayService,
  TransactionalOperationRunner,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabaseAuthorizationProfileReader } from "../../infrastructure/auth";
import { InProcessDomainEventPublisher } from "../../infrastructure/events";
import {
  SupabaseOrderOnTheWayGateway,
  SupabaseOrderOnTheWayTransactionBoundary,
} from "../../infrastructure/orders";
import { SupabaseRealtimePublisher } from "../../infrastructure/realtime";
import { createSupabaseAdminClient } from "../supabase/admin";
import {
  operationalTelemetry,
  operationalTelemetryClock,
} from "../observability/recorder";

export function createOrderOnTheWayService() {
  const client = createSupabaseAdminClient();
  const dispatcher = new InProcessDomainEventPublisher(operationalTelemetry);
  const realtimePublisher = new OrderOnTheWayRealtimePublisher(
    new SupabaseRealtimePublisher(
      client,
      operationalTelemetry,
      operationalTelemetryClock,
    ),
  );

  dispatcher.subscribe("order.on-the-way", (event) =>
    realtimePublisher.publish(Object.freeze([event])),
  );

  return new OrderOnTheWayService(
    new SupabaseAuthorizationProfileReader(client),
    new SupabaseOrderOnTheWayGateway(client),
    new SystemAuditClock(),
    new TransactionalOperationRunner(
      new SupabaseOrderOnTheWayTransactionBoundary(),
      dispatcher,
    ),
  );
}
