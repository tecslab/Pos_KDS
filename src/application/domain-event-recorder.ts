import type { DomainEvent } from "../domain";

export interface DomainEventRecorder<Event extends DomainEvent = DomainEvent> {
  record(event: Event): void;
}
