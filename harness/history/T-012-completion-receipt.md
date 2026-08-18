# Completion Receipt — T-012

- Task: Model inventory ledger, balances, and alerts.
- Verdict: Approved by independent `gpt-5.6-sol` High Reviewer.
- Commit: Pending task commit.
- Base: `f885817145129ff6aa6896972534e50fbfe7b8c2`.
- Behavior: restaurant-scoped raw/produced/resale items; immutable business-origin ledger movements; read-only derived balances; configured negative-stock policy with locking; active/resolved alert state and RLS.
- Remote: `create_inventory_ledger_schema`, version `20260818022054`; inventory tables/RLS and balance view verified.
- Checks: full check (67 tests), build, diff, Prisma, remote verification and harness validation passed.
- Next: T-013.
