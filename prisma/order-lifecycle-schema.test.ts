import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const schemaPath = new URL("./schema.prisma", import.meta.url);
const migrationPath = new URL(
  "./migrations/20260816160000_create_order_lifecycle_schema/migration.sql",
  import.meta.url,
);
const timestampHardeningMigrationPath = new URL(
  "./migrations/20260816170000_harden_order_lifecycle_timestamps/migration.sql",
  import.meta.url,
);

describe("order lifecycle schema", () => {
  it("models persisted orders without a Draft state", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const model of [
      "Order",
      "CustomerBasket",
      "OrderLine",
      "OrderLineSaleSnapshot",
      "OrderCancellation",
    ]) {
      expect(schema).toContain(`model ${model}`);
    }

    for (const status of [
      "PENDING",
      "READY",
      "ON_THE_WAY",
      "DELIVERED",
      "PAID",
      "CANCELLED",
    ]) {
      expect(schema).toMatch(new RegExp(`^\\s*${status}$`, "m"));
    }

    const orderStatus = schema.slice(
      schema.indexOf("enum OrderStatus"),
      schema.indexOf("enum CustomerBasketStatus"),
    );
    expect(orderStatus).not.toContain("DRAFT");
    expect(schema).toMatch(
      /orderNumber\s+String\s+@unique @map\("order_number"\)/,
    );

    for (const timestamp of [
      "createdAt",
      "readyAt",
      "onTheWayAt",
      "deliveredAt",
      "paidAt",
    ]) {
      expect(schema).toMatch(new RegExp(`^\\s*${timestamp}\\s+`, "m"));
    }
  });

  it("keeps every order relation inside its restaurant boundary", async () => {
    const migration = await readFile(migrationPath, "utf8");

    for (const relation of [
      "FOREIGN KEY (restaurant_id, service_location_id) REFERENCES public.service_locations(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, order_id) REFERENCES public.orders(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, basket_id) REFERENCES public.customer_baskets(restaurant_id, id)",
      "FOREIGN KEY (restaurant_id, product_version_id) REFERENCES public.product_versions(restaurant_id, id)",
    ]) {
      expect(migration).toContain(relation);
    }

    expect(migration).toContain(
      "FOREIGN KEY (assigned_waiter_id) REFERENCES public.application_users(id)",
    );
    expect(migration).toContain(
      "FOREIGN KEY (cancelled_by_id) REFERENCES public.application_users(id)",
    );
    expect(migration).toContain("ON DELETE RESTRICT ON UPDATE RESTRICT");
  });

  it("stores immutable, revisioned sale snapshots and a line-owned current pointer", async () => {
    const schema = await readFile(schemaPath, "utf8");
    const migration = await readFile(migrationPath, "utf8");

    for (const field of [
      "productVersionId",
      "productName",
      "quantity",
      "baseUnitPrice",
      "finalUnitPrice",
      "lineTotal",
      "taxCode",
      "taxName",
      "taxRate",
      "priceIncludesTax",
      "selectedOptions",
      "removedIngredients",
      "observations",
    ]) {
      expect(schema).toMatch(new RegExp(`^\\s*${field}\\s+`, "m"));
    }

    expect(schema).toContain(
      '@relation("CurrentLineSnapshot", fields: [restaurantId, id, currentSnapshotId], references: [restaurantId, orderLineId, id]',
    );
    expect(migration).toContain(
      "CONSTRAINT order_line_snapshots_line_revision_key UNIQUE (restaurant_id, order_line_id, revision_number)",
    );
    expect(migration).toContain("CONSTRAINT order_lines_current_snapshot_fkey");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration).toContain(
      "CHECK (line_total = quantity * final_unit_price)",
    );
    expect(migration).toContain(
      "CHECK (jsonb_typeof(selected_options) = 'array')",
    );
    expect(migration).toContain(
      "CHECK (jsonb_typeof(removed_ingredients) = 'array')",
    );
    expect(migration).toContain(
      "CREATE TRIGGER order_line_sale_snapshots_immutable",
    );
    expect(migration).toContain(
      "BEFORE UPDATE OR DELETE ON public.order_line_sale_snapshots",
    );
  });

  it("enforces lifecycle, cancellation, aggregate totals, and paid-basket rules", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain(
      "persisted orders must begin in PENDING status",
    );
    expect(migration).toContain(
      "customer baskets must begin in PENDING status",
    );
    expect(migration).toContain("invalid order transition from % to %");
    expect(migration).toContain(
      "(OLD.status = 'PENDING' AND NEW.status IN ('READY', 'CANCELLED'))",
    );
    expect(migration).toContain(
      "(OLD.status = 'READY' AND NEW.status IN ('ON_THE_WAY', 'CANCELLED'))",
    );
    expect(migration).toContain(
      "CONSTRAINT orders_lifecycle_timestamps_monotonic",
    );
    expect(migration).toContain("CONSTRAINT orders_status_timestamp_shape");
    expect(migration).toContain(
      "CONSTRAINT order_cancellations_prior_status_valid",
    );
    expect(migration).toContain("CREATE TRIGGER order_cancellations_immutable");
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER orders_cancellation_consistency",
    );
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER customer_baskets_totals_consistent",
    );
    expect(migration).toContain(
      "CREATE CONSTRAINT TRIGGER order_lines_totals_consistent",
    );
    expect(migration).toContain("paid order % must contain only paid baskets");
  });

  it("protects creation timestamps and orders cancellation after the latest lifecycle event", async () => {
    const migration = await readFile(timestampHardeningMigrationPath, "utf8");

    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_order_lifecycle_transition()",
    );
    expect(migration).toContain(
      "IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN",
    );
    expect(migration).toContain("order creation timestamp is immutable");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.validate_basket_lifecycle_transition()",
    );
    expect(migration).toContain("basket creation timestamp is immutable");
    expect(migration).toContain("SELECT status, created_at, ready_at");
    expect(migration).toContain("latest_lifecycle_at := GREATEST(");
    expect(migration).toContain("COALESCE(order_ready_at, order_created_at)");
    expect(migration).toContain(
      "IF NEW.cancelled_at < latest_lifecycle_at THEN",
    );
  });

  it("keeps PostgreSQL objects reviewable, default-deny, and seed-free", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const names = [
      ...migration.matchAll(
        /^(?:\\s*(?:ADD )?CONSTRAINT\\s+|CREATE (?:UNIQUE )?INDEX\\s+|CREATE (?:CONSTRAINT )?TRIGGER\\s+|CREATE (?:TYPE|TABLE|FUNCTION) public\\.)([a-z][a-z0-9_]*)/gm,
      ),
    ].map((match) => match[1]);

    expect(names.every((name) => Buffer.byteLength(name, "utf8") <= 63)).toBe(
      true,
    );
    expect(new Set(names).size).toBe(names.length);

    for (const table of [
      "orders",
      "customer_baskets",
      "order_lines",
      "order_line_sale_snapshots",
      "order_cancellations",
    ]) {
      expect(migration).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
      );
    }

    expect(migration).not.toMatch(/\\bCREATE\\s+POLICY\\b/i);
    expect(migration).not.toMatch(/\\bINSERT\\s+INTO\\b/i);
  });
});
