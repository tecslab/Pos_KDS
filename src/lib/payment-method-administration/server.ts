import "server-only";
import { randomUUID } from "node:crypto";
import {
  AuditEventService,
  PaymentMethodAdministrationService,
} from "../../application";
import { SystemAuditClock } from "../../infrastructure/audit";
import { SupabasePaymentMethodAdministrationGateway } from "../../infrastructure/configuration";
import { createSupabaseAdminClient } from "../supabase/admin";

export function createPaymentMethodAdministrationService() {
  const adapter = new SupabasePaymentMethodAdministrationGateway(
    createSupabaseAdminClient(),
  );
  return new PaymentMethodAdministrationService(
    adapter,
    new AuditEventService(adapter, new SystemAuditClock()),
    randomUUID,
  );
}
