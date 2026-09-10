# T-068 Completion Receipt

- Task: Build payment reporting.
- Base commit: `b78522991ca47c9cffdbb70e7f06d82e11db594a`.
- Implementation: `reports.view`-protected, persisted payment reporting provides daily revenue by immutable payment-method snapshot, historical outstanding and partial basket balances, and immutable payment history with recorder and overage evidence. The `/reports` view retains the approved `America/Guayaquil` midnight-to-midnight business-day boundary.
- Historical integrity repair: a forward-only migration reconstructs selected-day basket totals from immutable line revisions, removals, cancellations, and payments before the reporting cutoff. A later pending-order change cannot rewrite historical outstanding or partial balances.
- Scope: refund analytics and accounting/report exports were not added.
- Review: the initial independent review found mutable basket totals in historical balances. After repair, a fresh independent reviewer returned `Approved`.
- Verification: focused suite `29/29`; `env -u NODE_TLS_REJECT_UNAUTHORIZED npm run check` `1,289/1,289`; production build, Prisma validation, formatting, type checking, `git diff --check`, and harness validation passed.
- Remote migrations: `read_payment_report` and forward repair `preserve_payment_report_historical_balances` were applied to `carnales`. The rollback-only probe passed; `read_payment_report` is `SECURITY DEFINER`, uses `public, pg_temp`, allows `service_role`, and denies `authenticated` direct execution.
- Next suggested dependency-ready task: T-069 — Build inventory, production, and expense reporting.
