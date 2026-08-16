import type { DomainEvent } from "../domain";

export interface DomainEventPublisher<Event extends DomainEvent = DomainEvent> {
  publish(events: readonly Event[]): Promise<void>;
}
