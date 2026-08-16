export type DomainEvent<
  Type extends string = string,
  Payload = unknown,
> = Readonly<{
  type: Type;
  occurredAt: string;
  payload: Payload;
}>;
