import type { AuditEventRecord } from "./audit-event";

/**
 * Persistence port for immutable audit history. Deliberately exposes no update
 * or delete operation.
 */
export interface AuditEventAppender {
  append(event: AuditEventRecord): Promise<void>;
}
