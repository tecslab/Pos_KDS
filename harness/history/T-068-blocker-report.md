# T-068 Blocker Report

## Blocked work

T-068 — Build payment reporting.

## Blocker

The reviewed forward-only remote migration
`20260910100000_preserve_payment_report_historical_balances` cannot be applied
because the Supabase MCP OAuth token refresh fails before it reaches the
`carnales` project.

## Evidence and safe alternatives attempted

- The original payment-report migration was applied and its rollback-only probe
  passed.
- Independent review found that its end-of-day balance calculation used a
  mutable basket aggregate, so the required repair is a forward-only migration.
- The repair reconstructs balances from immutable order-line revisions,
  removals, cancellations, and payments; fresh independent review returned
  `Approved`.
- Two safe attempts to apply the exact forward-only migration failed with
  Supabase MCP OAuth refresh parsing errors before remote execution.
- Local verification passed: 1,289 tests, build, Prisma validation, formatting,
  lint, type checking, diff check, and harness validation.

## Required external action

Reconnect or reauthorize the Supabase MCP connection. Then apply the exact
forward-only migration, run `prisma/probes/T-068-payment-report-probes.sql`,
verify function security/grants, and commit the already approved task scope.

## Unrelated ready work

T-069 — Build inventory, production, and expense reporting is dependency-ready.
