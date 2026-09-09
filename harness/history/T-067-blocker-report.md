# T-067 Blocker Report

## Blocked work

T-067 — Build product, kitchen, and delivery performance reports.

## Blocker

The required sales-by-category report cannot be generated from immutable historical transaction data. `order_line_sale_snapshots` preserves product name, quantities, prices, and tax, but no product-category identifier or name. The only category relation is `products.category_id`, which is mutable. Joining it for historical sales would retroactively reclassify prior sales and violate PRD BI-028.

## Evidence and safe alternatives attempted

- Requirements routing resolved FR-REP-002–004, BI-026–028, timestamp, authorization, and reporting performance requirements.
- Targeted schema and migration inspection confirmed historical sale-snapshot inserts omit category data.
- The product administration RPC updates `products.category_id`, so current catalog attribution is not transaction-time evidence.
- Existing category audit events cannot deterministically or completely recreate a category snapshot for each historical sale.
- No production implementation changes were made; the task stopped before an unsafe report implementation.

## Required human decision

When we add a category snapshot for future sales, how should pre-existing sales with no historical category be shown?

Recommended: group them under a clearly labelled **Unattributed historical category**; do not infer their category from the current catalog.

## Unrelated ready work

T-068 — Build payment reporting remains dependency-ready.
