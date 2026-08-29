import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "prisma/migrations/20260828100000_modify_pending_orders_atomically/migration.sql",
  "utf8",
);
const hardeningSql = readFileSync(
  "prisma/migrations/20260829040000_harden_order_modification_aggregate_helper/migration.sql",
  "utf8",
);
const groupingRepairSql = readFileSync(
  "prisma/migrations/20260829090000_group_pending_order_modifications/migration.sql",
  "utf8",
);
const columnQualificationRepairSql = readFileSync(
  "prisma/migrations/20260829100000_qualify_pending_order_modification_columns/migration.sql",
  "utf8",
);
const behaviorProbeSql = readFileSync(
  "prisma/probes/T-042-pending-order-modification-probes.sql",
  "utf8",
);

describe("pending-order modification migration", () => {
  it("stores immutable removal evidence while retaining line and snapshot history", () => {
    expect(sql).toContain("CREATE TABLE public.order_line_removals");
    expect(sql).toContain("order_line_removals_immutable");
    expect(sql).toContain(
      "BEFORE UPDATE OR DELETE ON public.order_line_removals",
    );
    expect(sql).not.toMatch(
      /DELETE FROM public\.(?:order_lines|order_line_sale_snapshots)/i,
    );
  });

  it("enforces authorization, pending state, aggregate ownership, and concurrency in the RPC", () => {
    expect(sql).toContain("CREATE FUNCTION public.modify_pending_order(");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("permission.code = 'orders.edit'");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("ORDER_MODIFICATION_NOT_PENDING");
    expect(sql).toContain("ORDER_MODIFICATION_STALE_ORDER");
    expect(sql).toContain("basket.order_id = target_order.id");
  });

  it("recomputes active totals and writes one deterministic before/after audit event", () => {
    expect(sql).toContain("public.order_active_aggregate_json");
    expect(sql).toContain("removal.order_line_id IS NULL");
    expect(sql).toContain("'order.updated'");
    expect(sql).toContain("previous_aggregate, new_aggregate");
    expect(sql.match(/INSERT INTO public\.audit_events/g)).toHaveLength(1);
  });

  it("keeps the mutation RPC service-only", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.modify_pending_order\([\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.modify_pending_order\([\s\S]+TO service_role/,
    );
    expect(hardeningSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.order_active_aggregate_json\(uuid\)[\s\S]+FROM PUBLIC, anon, authenticated/,
    );
    expect(hardeningSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.order_active_aggregate_json\(uuid\)[\s\S]+TO service_role/,
    );
  });

  it("groups identical additions and consolidates matching replacements append-only", () => {
    expect(groupingRepairSql).toContain(
      "snapshot.product_version_id = product_version_id_value",
    );
    expect(groupingRepairSql).toContain(
      "snapshot.selected_options = selected_options_value",
    );
    expect(groupingRepairSql).toContain(
      "snapshot.removed_ingredients = removed_ingredients_value",
    );
    expect(groupingRepairSql).toContain(
      "snapshot.observations IS NOT DISTINCT FROM observation_value",
    );
    expect(groupingRepairSql).toContain(
      "merged_quantity := matching_snapshot.quantity::bigint + quantity_value::bigint",
    );
    expect(groupingRepairSql).toMatch(
      /INSERT INTO public\.order_line_sale_snapshots[\s\S]+SET current_snapshot_id = new_snapshot_id/,
    );
    expect(groupingRepairSql).toMatch(
      /operation_kind = 'replace' AND matching_line_id IS NOT NULL[\s\S]+INSERT INTO public\.order_line_removals/,
    );
    expect(groupingRepairSql).not.toMatch(
      /DELETE FROM public\.(?:order_lines|order_line_sale_snapshots)/i,
    );
  });

  it("advances concurrency and audit timestamps with one deterministic mutation instant", () => {
    expect(groupingRepairSql).toContain(
      "target_order.updated_at + interval '1 microsecond'",
    );
    expect(groupingRepairSql).toContain(
      "updated_at = modification_occurred_at",
    );
    expect(groupingRepairSql).toMatch(
      /actor_user_id, modification_occurred_at, 'order\.updated'/,
    );
  });

  it("qualifies columns that collide with the RPC output variables", () => {
    expect(columnQualificationRepairSql).toContain(
      "CREATE OR REPLACE FUNCTION public.modify_pending_order(",
    );
    expect(columnQualificationRepairSql).toContain(
      "target_basket.restaurant_id = target_order.restaurant_id",
    );
    expect(columnQualificationRepairSql).toContain(
      "target_basket.order_id = target_order.id",
    );
    expect(columnQualificationRepairSql).toContain(
      "target_basket.status = 'PENDING'",
    );
    expect(columnQualificationRepairSql).toContain(
      "line_to_update.restaurant_id = target_order.restaurant_id",
    );
    expect(columnQualificationRepairSql).not.toMatch(
      /FROM public\.customer_baskets\s+WHERE restaurant_id\s*=/,
    );
    expect(columnQualificationRepairSql).not.toMatch(
      /UPDATE public\.order_lines\s+SET[\s\S]+?WHERE restaurant_id\s*=/,
    );
  });

  it("ships a rollback-only PostgreSQL behavior probe for the complete mutation boundary", () => {
    expect(behaviorProbeSql).toMatch(/^BEGIN;/);
    expect(behaviorProbeSql).toMatch(/ROLLBACK;\s*$/);
    expect(behaviorProbeSql).toContain(
      "authorization probe failed: unauthorized modification was accepted",
    );
    expect(behaviorProbeSql).toContain("ORDER_MODIFICATION_NOT_PENDING");
    expect(behaviorProbeSql).toContain("ORDER_MODIFICATION_STALE_ORDER");
    expect(behaviorProbeSql).toContain(
      "identical add did not append one grouped revision and audit",
    );
    expect(behaviorProbeSql).toContain(
      "replace did not preserve append-only grouped history",
    );
    expect(behaviorProbeSql).toContain(
      "rejected operation set persisted partial state",
    );
    expect(behaviorProbeSql).toContain("previous_values ->> 'totalAmount'");
    expect(behaviorProbeSql).toContain("new_values ->> 'totalAmount'");
  });
});
