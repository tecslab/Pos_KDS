# Completion Receipt — T-060

- Task: Implement inventory adjustment and waste registration.
- Final verdict: Approved by a fresh independent `gpt-5.6-sol`, high Reviewer.
- Commit: pending (this receipt is committed with implementation).
- Complexity classification: High — inventory transaction, immutable history, authorization, audit, database migration, and event boundaries.
- Model and reasoning assignments: Requirements Router `gpt-5.6-terra`, medium; Architect `gpt-5.6-sol`, high; Implementer `gpt-5.6-sol`, high; Reviewer `gpt-5.6-sol`, high.
- Base commit: `aef121185fdaee047bcfad15c9a6dacdf10b7557`.
- Outcome: Separate permission-authorized adjustment and waste registrations append immutable origin and movement records atomically, require reason/actor/timestamp, audit prior/new balance, enforce the restaurant's configured negative-stock setting, and publish safe post-commit inventory updates.
- Remote evidence: Supabase migration `20260907090000_register_inventory_adjustments_and_waste_atomically` was applied to `carnales`; its rollback-only probe passed. The RPC is `SECURITY DEFINER`, uses `public, pg_temp`, grants only `service_role`, and origin tables have RLS enabled.
- Verification: focused checks passed (28 tests); Prisma format/validation, typecheck, and diff check passed. Full suite was rerun with `NODE_TLS_REJECT_UNAUTHORIZED` removed because the host-injected insecure value fails the repository's intentional TLS-security test; independent review approved the complete diff.
- PRD references verified: PRD §5.5 FR-INV-004/005/007, §6.12, §8.11, BI-018–021, authorization/audit requirements, and transaction/event architecture constraints.
- Architectural decision records: ADR-001 applied for remote migration and probe verification.
- Next suggested dependency-ready task: T-061 — Build inventory adjustment and waste UI.
