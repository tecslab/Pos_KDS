import { err, ok, type Result } from "../../domain";
import type { AuditEventService } from "../audit";

export type OperatingSettings = Readonly<{
  restaurantId: string;
  restaurantName: string;
  taxRateId: string;
  taxName: string;
  taxRatePercent: number;
  opensAt: string;
  closesAt: string;
  preparationWarningMinutes: number;
  preparationCriticalMinutes: number;
  deliveryWarningMinutes: number;
  deliveryCriticalMinutes: number;
  allowNegativeStock: boolean;
}>;

export type UpdateOperatingSettingsInput = Readonly<{
  restaurantId: string;
  taxRateId: string;
  restaurantName: string;
  taxName: string;
  taxRatePercent: string;
  opensAt: string;
  closesAt: string;
  preparationWarningMinutes: string;
  preparationCriticalMinutes: string;
  deliveryWarningMinutes: string;
  deliveryCriticalMinutes: string;
  allowNegativeStock: boolean;
}>;

export interface OperatingSettingsGateway {
  list(): Promise<readonly OperatingSettings[]>;
  update(
    actorId: string,
    settings: OperatingSettings,
  ): Promise<OperatingSettings>;
}

export type OperatingSettingsError = Readonly<{
  kind: "operating-settings-error";
  code: "INVALID_INPUT" | "OPERATION_FAILED";
}>;

export class OperatingSettingsService {
  constructor(
    private readonly gateway: OperatingSettingsGateway,
    private readonly audit: AuditEventService,
  ) {}

  async list(): Promise<
    Result<readonly OperatingSettings[], OperatingSettingsError>
  > {
    try {
      return ok(Object.freeze([...(await this.gateway.list())]));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }

  async update(
    actorId: string,
    input: UpdateOperatingSettingsInput,
  ): Promise<Result<OperatingSettings, OperatingSettingsError>> {
    const normalized = normalize(input);
    if (!isUuid(actorId) || normalized === null) {
      return failure("INVALID_INPUT");
    }
    try {
      const current = (await this.gateway.list()).find(
        (settings) => settings.restaurantId === normalized.restaurantId,
      );
      if (current === undefined || current.taxRateId !== normalized.taxRateId) {
        return failure("OPERATION_FAILED");
      }
      const audit = await this.audit.record({
        actorId,
        action: "restaurant.operating_settings_updated",
        entityType: "restaurant",
        entityId: normalized.restaurantId,
        previousValues: snapshot(current),
        newValues: snapshot(normalized),
      });
      if (!audit.ok) return failure("OPERATION_FAILED");
      return ok(await this.gateway.update(actorId, normalized));
    } catch {
      return failure("OPERATION_FAILED");
    }
  }
}

function normalize(
  input: UpdateOperatingSettingsInput,
): OperatingSettings | null {
  const restaurantName = input.restaurantName.trim().replace(/\s+/g, " ");
  const taxName = input.taxName.trim().replace(/\s+/g, " ");
  const taxRatePercent = decimal(input.taxRatePercent);
  const preparationWarningMinutes = integer(input.preparationWarningMinutes);
  const preparationCriticalMinutes = integer(input.preparationCriticalMinutes);
  const deliveryWarningMinutes = integer(input.deliveryWarningMinutes);
  const deliveryCriticalMinutes = integer(input.deliveryCriticalMinutes);
  if (
    !isUuid(input.restaurantId) ||
    !isUuid(input.taxRateId) ||
    restaurantName.length < 2 ||
    restaurantName.length > 160 ||
    taxName.length < 2 ||
    taxName.length > 80 ||
    taxRatePercent === null ||
    taxRatePercent < 0 ||
    taxRatePercent > 100 ||
    !isTime(input.opensAt) ||
    !isTime(input.closesAt) ||
    input.opensAt >= input.closesAt ||
    preparationWarningMinutes === null ||
    preparationCriticalMinutes === null ||
    preparationCriticalMinutes < preparationWarningMinutes ||
    deliveryWarningMinutes === null ||
    deliveryCriticalMinutes === null ||
    deliveryCriticalMinutes < deliveryWarningMinutes
  )
    return null;
  return Object.freeze({
    restaurantId: input.restaurantId,
    restaurantName,
    taxRateId: input.taxRateId,
    taxName,
    taxRatePercent,
    opensAt: input.opensAt,
    closesAt: input.closesAt,
    preparationWarningMinutes,
    preparationCriticalMinutes,
    deliveryWarningMinutes,
    deliveryCriticalMinutes,
    allowNegativeStock: input.allowNegativeStock,
  });
}

function snapshot(settings: OperatingSettings) {
  return {
    name: settings.restaurantName,
    taxName: settings.taxName,
    taxRate: settings.taxRatePercent / 100,
    businessHours: {
      daily: { opensAt: settings.opensAt, closesAt: settings.closesAt },
    },
    preparationWarningMinutes: settings.preparationWarningMinutes,
    preparationCriticalMinutes: settings.preparationCriticalMinutes,
    deliveryWarningMinutes: settings.deliveryWarningMinutes,
    deliveryCriticalMinutes: settings.deliveryCriticalMinutes,
    allowNegativeStock: settings.allowNegativeStock,
  };
}

function integer(value: string): number | null {
  return /^\d{1,4}$/.test(value) && Number(value) <= 1440
    ? Number(value)
    : null;
}

function decimal(value: string): number | null {
  return /^(?:\d{1,3})(?:\.\d{1,4})?$/.test(value) ? Number(value) : null;
}

function isTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function failure(
  code: OperatingSettingsError["code"],
): Result<never, OperatingSettingsError> {
  return err(Object.freeze({ kind: "operating-settings-error", code }));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
