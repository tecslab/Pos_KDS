import type { DomainEvent, Result } from "../domain";

import type { DomainEventPublisher } from "./domain-event-publisher";
import type { DomainEventRecorder } from "./domain-event-recorder";
import type { TransactionBoundary } from "./transaction-boundary";

export type TransactionalOperation<T, E, Event extends DomainEvent> = (
  events: DomainEventRecorder<Event>,
) => Promise<Result<T, E>>;

/**
 * Coordinates a transaction and releases its recorded events only after the
 * transaction successfully commits. Publishing is post-commit: a publisher
 * failure propagates to the caller and cannot roll back or retry the commit.
 */
export class TransactionalOperationRunner<
  Event extends DomainEvent = DomainEvent,
> {
  constructor(
    private readonly transaction: TransactionBoundary,
    private readonly publisher: DomainEventPublisher<Event>,
  ) {}

  async run<T, E>(
    operation: TransactionalOperation<T, E, Event>,
  ): Promise<Result<T, E>> {
    const bufferedEvents: Event[] = [];
    const recorder: DomainEventRecorder<Event> = {
      record(event) {
        bufferedEvents.push(event);
      },
    };

    const result = await this.transaction.run(() => operation(recorder));

    if (!result.ok || bufferedEvents.length === 0) {
      return result;
    }

    await this.publisher.publish(Object.freeze([...bufferedEvents]));

    return result;
  }
}
