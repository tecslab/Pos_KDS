import type { DomainEventPublisher } from "../../application";
import type { DomainEvent } from "../../domain";

export type DomainEventHandler<Event extends DomainEvent> = (
  event: Event,
) => void | Promise<void>;

/**
 * Dispatches events inline in FIFO order. Handlers for an event run in their
 * registration order. Handler failures stop dispatch and propagate without
 * retries; callers may already have committed their transaction.
 */
export class InProcessDomainEventPublisher<
  Events extends DomainEvent = DomainEvent,
> implements DomainEventPublisher<Events> {
  private readonly handlers = new Map<
    Events["type"],
    DomainEventHandler<Events>[]
  >();

  subscribe<Type extends Events["type"]>(
    type: Type,
    handler: DomainEventHandler<Extract<Events, { type: Type }>>,
  ): void {
    const handlers = this.handlers.get(type) ?? [];
    handlers.push(handler as DomainEventHandler<Events>);
    this.handlers.set(type, handlers);
  }

  async publish(events: readonly Events[]): Promise<void> {
    for (const event of events) {
      const handlers = this.handlers.get(event.type) ?? [];

      for (const handler of handlers) {
        await handler(event);
      }
    }
  }
}
