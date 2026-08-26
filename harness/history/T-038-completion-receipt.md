# T-038 Completion Receipt

- Task: Add resale-item consumption to order confirmation.
- Base commit: `e10ac4b3a6caf2166e2ecb3f4cbdc77c7cf6be5b` (clean worktree).
- Model assignment: Requirements Router `gpt-5.6-terra` / medium; required Architect, Implementer, and fresh independent Reviewer `gpt-5.6-sol` / high. High complexity was required by inventory transaction, immutable-history, and cross-module consistency risks.
- Behavior: The single confirmation RPC aggregates resale quantities per inventory item, locks eligible resale sources deterministically, creates one negative `SALE` movement per item using its canonical unit and the order as immutable business origin, and writes a matching `inventory_movement.sale_recorded` audit with contributing sale snapshots. Recipe-backed and source-less products do not consume inventory. The existing ledger trigger remains the negative-stock authority; its specific rejection maps to the typed `INSUFFICIENT_INVENTORY` business error, with the entire confirmation transaction rolled back.
- Scope exclusions respected: no raw-ingredient consumption, production, cancellation rollback, API/UI/realtime changes, inventory alerts, or schema-model expansion.
- Remote migration: Applied through Supabase MCP as `20260826042103 consume_resale_inventory_on_order_confirmation` to Carnales. Migration history and a rollback-only transaction probe were independently verified; probe cleanup left zero users, orders, and movements.
- Reviewer: fresh independent `gpt-5.6-sol` / high reviewer verdict `Approved`.
- Verification: 34 focused tests; full quality suite 527/527; lint, formatting, typecheck, Prisma validation, harness validation, and `git diff --check` passed. The full suite was run with inherited `NODE_TLS_REJECT_UNAUTHORIZED=0` removed because that insecure ambient value intentionally causes unrelated TLS-guard failures.
- Next suggested dependency-ready task: T-039 — Expose the transactional order-confirmation API.
