import type { AuditClock } from "../../application";

export class SystemAuditClock implements AuditClock {
  now(): Date {
    return new Date();
  }
}
