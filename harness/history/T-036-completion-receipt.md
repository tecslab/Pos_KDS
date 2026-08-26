# T-036 Completion Receipt

- Task: Build the client-only PoS order draft composer.
- Base commit: `366c5d9b2e331a85d6e3dbd86d1a5ca92575d482`.
- Behavior: Adds an `orders.create`-protected, reachable `/orders` PoS composer. It reads only the authorized T-035 ordering context, keeps location, baskets, configured lines, quantities, observations, and totals in React memory, groups only identical configurations, and resets incompatible draft contents when the restaurant changes.
- Scope exclusions respected: no order save or confirmation, server action, mutation, storage, database/schema, audit, printer, realtime, or inventory behavior was added.
- Reviewer: independent `gpt-5.6-sol` / high reviewer verdict `Approved` after one repair cycle. The initial review caught a disabled PoS navigation link and cross-restaurant draft retention; both were repaired and fresh-reviewed.
- Verification: focused tests (32), full suite (491), lint, formatting, typecheck, Prisma schema validation, production build, harness validation, `git diff --check`, and scoped secret inspection passed. `NODE_TLS_REJECT_UNAUTHORIZED` was unset for test/build verification because its inherited value was insecure and caused unrelated proxy-test failures.
- Next suggested dependency-ready task: T-037 — Implement the order confirmation domain use case.
