import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("./schema.prisma", import.meta.url);
const migrationPath = new URL(
  "./migrations/20260816120000_create_restaurant_configuration_schema/migration.sql",
  import.meta.url,
);

describe("restaurant configuration schema", () => {
  it("models restaurant-scoped configuration without business-value defaults", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const restaurantSchema = schema.slice(schema.indexOf("model Restaurant"));

    for (const model of [
      "Restaurant",
      "RestaurantConfiguration",
      "ServiceLocation",
      "PaymentMethod",
      "RestaurantTaxRate",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }

    expect(schema).toMatch(
      /restaurantId\s+String\s+@id @map\("restaurant_id"\) @db\.Uuid/,
    );
    expect(schema).toMatch(
      /serviceChargeRate\s+Decimal\s+@map\("service_charge_rate"\) @db\.Decimal\(7, 6\)/,
    );
    for (const field of [
      "address",
      "taxId",
      "contactInformation",
      "logoUrl",
      "receiptHeader",
      "receiptFooter",
      "thermalPrinterConfiguration",
      "preparationWarningThresholdMinutes",
      "preparationCriticalThresholdMinutes",
      "deliveryWarningThresholdMinutes",
      "deliveryCriticalThresholdMinutes",
      "inventoryPolicy",
      "printingBehavior",
      "businessHours",
    ]) {
      expect(restaurantSchema).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }
    expect(schema).toMatch(
      /allowsMultipleActiveOrders\s+Boolean\s+@map\("allows_multiple_active_orders"\)/,
    );
    expect(schema).toMatch(
      /bankAccountConfiguration\s+Json\?\s+@map\("bank_account_configuration"\) @db\.JsonB/,
    );
    expect(schema).toMatch(/rate\s+Decimal\s+@db\.Decimal\(7, 6\)/);
    expect(schema).toContain("@@unique([restaurantId, name])");
    expect(schema).toContain("@@unique([restaurantId, code])");
    expect(schema).toContain("@@index([restaurantId, isActive, displayOrder])");

    for (const field of [
      "isActive",
      "allowsMultipleActiveOrders",
      "serviceChargeRate",
      "preparationWarningThresholdMinutes",
      "preparationCriticalThresholdMinutes",
      "deliveryWarningThresholdMinutes",
      "deliveryCriticalThresholdMinutes",
      "inventoryPolicy",
      "printingBehavior",
      "businessHours",
    ]) {
      expect(restaurantSchema).not.toMatch(
        new RegExp(`^\\s*${field}\\s+[^\\n]*@default`, "m"),
      );
    }
  });

  it("enforces scoped uniqueness, configuration shape, and operational bounds", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CONSTRAINT service_locations_restaurant_id_name_key UNIQUE (restaurant_id, name)",
    );
    expect(migration).toContain(
      "CONSTRAINT payment_methods_restaurant_id_code_key UNIQUE (restaurant_id, code)",
    );
    expect(migration).toContain(
      "CONSTRAINT restaurant_tax_rates_restaurant_id_code_key UNIQUE (restaurant_id, code)",
    );
    expect(migration).toContain(
      "CHECK (service_charge_rate >= 0 AND service_charge_rate <= 1)",
    );
    expect(migration).toContain(
      "preparation_critical_threshold_minutes >= preparation_warning_threshold_minutes",
    );
    expect(migration).toContain(
      "delivery_critical_threshold_minutes >= delivery_warning_threshold_minutes",
    );
    expect(migration).toContain("CHECK (display_order >= 0)");
    expect(migration).toContain("CHECK (rate >= 0 AND rate <= 1)");
    expect(migration).toContain("is_active boolean NOT NULL");
    expect(migration).toContain(
      "allows_multiple_active_orders boolean NOT NULL",
    );
    expect(migration).not.toMatch(/is_active boolean NOT NULL DEFAULT/i);

    for (const table of [
      "restaurant_configurations",
      "service_locations",
      "payment_methods",
      "restaurant_tax_rates",
    ]) {
      expect(migration).toContain(
        `CONSTRAINT ${table}_restaurant_fkey\n    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
      );
    }

    for (const configuration of [
      "contact_information",
      "thermal_printer_configuration",
      "inventory_policy",
      "printing_behavior",
      "business_hours",
      "bank_account_configuration",
      "receipt_configuration",
    ]) {
      expect(migration).toContain(`jsonb_typeof(${configuration}) = 'object'`);
    }

    for (const table of [
      "restaurants",
      "service_locations",
      "payment_methods",
      "restaurant_tax_rates",
    ]) {
      expect(migration).toContain(
        `CONSTRAINT ${table}_deleted_not_active CHECK (deleted_at IS NULL OR NOT is_active)`,
      );
    }
  });

  it("requires one configuration per restaurant and leaves RLS default-deny", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER restaurants_require_configuration",
    );
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER restaurant_configurations_preserve_on_delete",
    );
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER restaurant_configurations_preserve_on_restaurant_change",
    );

    for (const table of [
      "restaurants",
      "restaurant_configurations",
      "service_locations",
      "payment_methods",
      "restaurant_tax_rates",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
    }

    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/i);
  });
});
