import { err, ok, type Result } from "../../domain";
import type { AuditEventService } from "../audit";

export type ServiceLocation = Readonly<{
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  type: string;
  displayOrder: number;
  isActive: boolean;
  allowsMultipleActiveOrders: boolean;
}>;

export type SaveServiceLocationInput = Readonly<{
  id?: string;
  restaurantId: string;
  name: string;
  type: string;
  displayOrder: string;
  isActive: boolean;
  allowsMultipleActiveOrders: boolean;
}>;

export interface ServiceLocationAdministrationGateway {
  list(): Promise<readonly ServiceLocation[]>;
  save(actorId: string, location: ServiceLocation): Promise<ServiceLocation>;
}

export type ServiceLocationAdministrationError = Readonly<{
  kind: "service-location-administration-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class ServiceLocationAdministrationService {
  constructor(
    private readonly gateway: ServiceLocationAdministrationGateway,
    private readonly audit: AuditEventService,
    private readonly createId: () => string,
  ) {}

  async list(): Promise<
    Result<readonly ServiceLocation[], ServiceLocationAdministrationError>
  > {
    try {
      return ok(Object.freeze([...(await this.gateway.list())]));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async save(
    actorId: string,
    input: SaveServiceLocationInput,
  ): Promise<Result<ServiceLocation, ServiceLocationAdministrationError>> {
    const normalized = normalize(input, this.createId);
    if (!isUuid(actorId) || normalized === null)
      return failure("INVALID_INPUT");
    try {
      const current = (await this.gateway.list()).find(
        (item) => item.id === normalized.id,
      );
      if (
        current !== undefined &&
        current.restaurantId !== normalized.restaurantId
      )
        return failure("OPERATION_FAILED");
      const desired = Object.freeze({
        ...normalized,
        restaurantName: current?.restaurantName ?? "",
      });
      const audit = await this.audit.record({
        actorId,
        action: current
          ? current.isActive !== desired.isActive
            ? desired.isActive
              ? "service_location.activated"
              : "service_location.deactivated"
            : "service_location.updated"
          : "service_location.created",
        entityType: "service_location",
        entityId: desired.id,
        previousValues: current ? snapshot(current) : null,
        newValues: snapshot(desired),
      });
      if (!audit.ok) return failure("OPERATION_FAILED");
      return ok(await this.gateway.save(actorId, desired));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

function normalize(input: SaveServiceLocationInput, createId: () => string) {
  const id = input.id?.trim() || createId();
  const name = input.name.trim().replace(/\s+/g, " ");
  const type = input.type.trim().replace(/\s+/g, "_").toUpperCase();
  const displayOrder = /^\d{1,6}$/.test(input.displayOrder)
    ? Number(input.displayOrder)
    : -1;
  if (
    !isUuid(id) ||
    !isUuid(input.restaurantId) ||
    name.length < 1 ||
    name.length > 120 ||
    type.length < 1 ||
    type.length > 80 ||
    displayOrder < 0 ||
    displayOrder > 100000
  )
    return null;
  return Object.freeze({
    id,
    restaurantId: input.restaurantId,
    name,
    type,
    displayOrder,
    isActive: input.isActive,
    allowsMultipleActiveOrders: input.allowsMultipleActiveOrders,
  });
}

function snapshot(location: ServiceLocation) {
  return {
    restaurantId: location.restaurantId,
    name: location.name,
    type: location.type,
    displayOrder: location.displayOrder,
    isActive: location.isActive,
    allowsMultipleActiveOrders: location.allowsMultipleActiveOrders,
  };
}

function failure(
  code: ServiceLocationAdministrationError["code"],
): Result<never, ServiceLocationAdministrationError> {
  return err(
    Object.freeze({ kind: "service-location-administration-error", code }),
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
