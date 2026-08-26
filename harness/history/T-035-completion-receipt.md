# T-035 Completion Receipt

- Task: Expose active menu and service-location data for PoS.
- Base commit: `064efd97b241bedd0789279c796a441c2dfa4cd3`.
- Behavior: `GET /api/v1/pos/ordering-context` provides an `orders.create`-authorized, read-only ordering context containing active restaurants, service locations, categories, products, latest product-version price/tax snapshots, and version-scoped allowed modifications. Unauthenticated and unauthorized callers receive JSON 401 and 403 responses; read failures are sanitized.
- Scope exclusions respected: no draft persistence, order confirmation, write/RPC/migration, audit, inventory, realtime, or UI behavior was added.
- Reviewer: independent `gpt-5.6-sol` / high reviewer verdict `Approved`.
- Verification: focused tests (22), full suite (480), lint, formatting, typecheck, Prisma schema validation, production build, harness validation, and `git diff --check` passed. The inherited unsafe TLS override was removed for full-suite verification; no source or configuration was weakened.
- Next suggested dependency-ready task: T-036 — Build the client-only PoS order draft composer.
