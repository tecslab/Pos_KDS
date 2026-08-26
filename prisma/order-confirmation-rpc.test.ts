import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = new URL(
  "./migrations/20260825100000_confirm_orders_atomically/migration.sql",
  import.meta.url,
);

describe("order confirmation RPC", () => {
  it("owns the complete aggregate, sale snapshot, and audit transaction", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE FUNCTION public.confirm_order");
    for (const table of [
      "orders",
      "customer_baskets",
      "order_lines",
      "order_line_sale_snapshots",
      "audit_events",
    ]) {
      expect(sql).toMatch(new RegExp(`INSERT INTO public\\.${table}`));
    }
    expect(sql).toContain("snapshot_id_to_insert, target_restaurant_id");
    expect(sql).toContain("line_id_to_insert, 1,");
    expect(sql).toContain("'order.confirmed'");
    expect(sql).toContain("previous_values, new_values, source_ip");
    expect(sql).not.toMatch(
      /UPDATE public\.(?:orders|customer_baskets|order_lines)/i,
    );
    expect(sql).not.toMatch(
      /DELETE FROM public\.(?:orders|customer_baskets|order_lines|order_line_sale_snapshots)/i,
    );
  });

  it("authorizes defensively and serializes service-location capacity", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("application_user.is_active");
    expect(sql).toContain("permission.code = 'orders.create'");
    expect(sql).toContain(
      "FOR SHARE OF application_user, assignment, role_permission, permission",
    );
    expect(sql).toContain("USING ERRCODE = '42501'");
    expect(sql).toMatch(
      /FROM public\.service_locations AS location[\s\S]+FOR UPDATE OF location[\s\S]+FOR SHARE OF restaurant/,
    );
    expect(sql).toContain("location.allows_multiple_active_orders");
    for (const status of ["PENDING", "READY", "ON_THE_WAY", "DELIVERED"])
      expect(sql).toContain(`'${status}'`);
    expect(sql).not.toMatch(
      /active_order\.status IN \([^)]*'PAID'|active_order\.status IN \([^)]*'CANCELLED'/,
    );
  });

  it("canonicalizes a nonempty draft and reads current same-restaurant catalog values", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("jsonb_array_length(draft_baskets) < 1");
    expect(sql).toContain("nonempty_basket_count = 0");
    expect(sql).toContain("ON CONFLICT (");
    expect(sql).toContain(
      "SET quantity = pg_temp.order_confirmation_lines.quantity + EXCLUDED.quantity",
    );
    expect(sql).toContain("version.restaurant_id = target_restaurant_id");
    expect(sql).toContain("SELECT max(current_version.version_number)");
    expect(sql).toContain("product.is_active");
    expect(sql).toContain("category.is_active");
    expect(sql).toContain("catalog.is_active");
    expect(sql).toContain("FOR SHARE OF version, product, category, catalog");
    expect(sql).toContain("option.id = ANY(canonical_line.option_ids)");
    expect(sql).toContain("ingredient.id = ANY(canonical_line.removal_ids)");
    expect(sql).toContain("ORDER_CONFIRMATION_STALE_CONFIGURATION");
  });

  it("calculates exact line, basket, and order totals from immutable configuration", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("final_unit_price_value := catalog_line.unit_price");
    expect(sql).toContain(
      "line_total_value := final_unit_price_value * canonical_line.quantity",
    );
    expect(sql).toContain("SELECT sum(line_total) INTO order_total_value");
    expect(sql).toContain("SELECT sum(line_total) INTO basket_total_value");
    expect(sql).toContain("order_total_value > 9999999999.99");
    expect(sql).toContain("selected_options = selected_options_value");
    expect(sql).toContain("removed_ingredients = removed_ingredients_value");
  });

  it("allocates globally non-reused numbers and is service-role-only", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("CREATE SEQUENCE public.order_number_sequence");
    expect(sql).toContain("max(substring(order_number FROM '^ORD-([0-9]+)$')");
    expect(sql).toContain("nextval('public.order_number_sequence')::text");
    expect(sql).toMatch(
      /REVOKE ALL ON SEQUENCE public\.order_number_sequence FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.confirm_order\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.confirm_order\([\s\S]+TO service_role/,
    );
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public, pg_temp");
  });

  it("does not consume inventory or implement downstream transports", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?public\.inventory_movements/i,
    );
    expect(sql).not.toMatch(/printer|kitchen|realtime/i);
  });
});
