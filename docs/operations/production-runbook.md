# Carnales production operations runbook

This runbook covers the Vercel application and its Supabase database,
authentication, and Realtime dependencies. It is an operator procedure, not
evidence that production services have been configured. T-077 must close every
release gate below before the first production release.

## T-077 production release gates

Do not approve a production launch until the approved business configuration
records all of the following outside this repository:

- recovery point objective (RPO) and recovery time objective (RTO);
- backup type, schedule, retention period, and geographic or account isolation;
- named deployment, database, incident-command, security, and restore owners;
- on-call schedule, contact method, escalation chain, and provider support path;
- monitoring destination, alert thresholds, notification routing, and test
  evidence; and
- the production Vercel project/domain and Supabase project identifiers.

The release approver must link the approved policy and non-secret evidence in
T-077. A missing or untested gate is a stop condition, not permission to choose
a default during an incident.

## Production deployment

### Prepare and approve

1. Select an immutable reviewed commit. Confirm that its task receipts identify
   every required SQL artifact and remote migration name.
2. From a clean checkout of that commit, install locked dependencies and run:

   ```bash
   npm ci
   env -u NODE_TLS_REJECT_UNAUTHORIZED npm run check
   env -u NODE_TLS_REJECT_UNAUTHORIZED npm run build
   git diff --check
   ```

   Do not bypass TLS verification. Stop on any failure or unexpected generated
   diff.

3. In Vercel, confirm the target project and environment. Confirm that only
   these application configuration names are present where required:

   - `NEXT_PUBLIC_SUPABASE_URL` — public browser configuration;
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public browser credential; and
   - `SUPABASE_SECRET_KEY` — server-only credential, never exposed to the
     browser, build output, logs, tickets, screenshots, or repository.

   Read values only in the approved provider secret stores. Never paste or
   record values in this runbook, command output, Git, or harness evidence.

4. If the release has a database change, complete **Database migration** before
   promoting application code that depends on it. Database changes must be
   backward compatible with the currently running application. Split an
   incompatible change across releases.
5. Create a Vercel preview/deployment for the reviewed commit. Verify build
   provenance and the safe health signals below, then have the T-077 named
   deployment owner promote that exact deployment to production.
6. Repeat the safe health checks against production. Record commit, Vercel
   deployment identifier, Supabase migration names/versions, operator,
   timestamps, and pass/fail results without secrets or business payloads.

Do not seed development reference data or create users as part of production
deployment. Production business configuration and initial users require their
separately approved procedures.

## Database migration: inspect, apply, verify

ADR-001 governs all remote database changes. `prisma/schema.prisma` is the
reviewed schema artifact and each
`prisma/migrations/<timestamp>_<migration-name>/migration.sql` is the exact,
versioned SQL artifact. Supabase MCP migration history is the remote authority.

For every migration:

1. **Inspect through the connected Supabase MCP.** Confirm the exact target
   project, relevant schemas/functions/policies, and remote migration history.
   Compare that state with the reviewed Prisma schema and SQL artifact. Stop on
   drift, an unexpected target, or an already-used migration name with
   different SQL.
2. **Apply through Supabase MCP.** Submit the exact reviewed SQL under the name
   matching the artifact directory. Apply migrations in repository order, one
   at a time, and capture the non-secret MCP result.
3. **Verify through Supabase MCP.** Reinspect migration history and every
   affected table, constraint, function, trigger, RLS policy, and privilege.
   Confirm the recorded migration name/version and compare the resulting shape
   with `prisma/schema.prisma` and the SQL artifact. For privileged functions,
   verify the reviewed execution grants and `search_path` constraints.
4. Run a checked-in rollback-only probe against the isolated preproduction
   target only when it was reviewed for that target. Confirm its transaction
   ends in `ROLLBACK` and leaves no rows. Do not run a mutation probe against
   production; use the read-only MCP post-application inspection there.
5. Record the artifact path, migration name/version, inspections, and results.
   Never record rows, credentials, connection strings, or customer data.

Never use a direct database URL, SQL shell, or Prisma remote command against
Supabase. In particular, do not use `prisma migrate dev`,
`prisma migrate deploy`, `prisma db push`, or `prisma db execute` for a remote
project. MCP inspection, application, and verification are mandatory even
during an incident.

## Rollback and forward correction

Treat application and database recovery as different operations:

- **Application rollback:** stop promotion, or use Vercel to promote the last
  known-good immutable deployment. Re-run safe health checks and record both
  deployment identifiers. This does not roll back the database.
- **Database correction:** do not run a down migration, delete migration
  history, restore an old backup over production, or reverse committed business
  history to match an older application. Inspect current state through MCP,
  prepare a new reviewable forward-only SQL artifact, obtain the required
  review, apply it through MCP, and verify it through MCP.

If the previous application cannot operate safely with the current schema,
disable or isolate the affected path using an already approved control and
escalate. Do not improvise a destructive database rollback. A production
restore is a disaster-recovery decision governed by the approved RPO/RTO and
incident authority, not a routine deployment rollback.

## Backup verification

The T-077 named backup owner performs this at the approved schedule and before
any high-risk migration:

1. In the Supabase control plane, verify the configured backup/PITR mechanism,
   latest successful recovery point, retention window, target project, and any
   provider-reported failure. Compare recovery-point age with the approved RPO;
   do not infer success from the absence of alerts.
2. Confirm the recovery point covers the PostgreSQL data and metadata required
   by the application. Confirm the separately approved treatment of Supabase
   Authentication identities and any provider resources not included in a
   database backup.
3. Record only the project identifier, recovery-point/backup identifier,
   provider status, covered time, verification time, operator, and policy
   comparison. Store evidence in the approved restricted operations system.
4. Treat an overdue, failed, incomplete, or unidentifiable recovery point as an
   incident. Pause high-risk migrations and follow the escalation policy.

A dashboard status verifies that a recovery point was reported; only an
isolated restore rehearsal verifies recoverability.

## Isolated restore rehearsal

Run at the T-077 approved frequency and after a material schema or backup-policy
change. Never restore over production for a rehearsal.

1. Open a tracked change/incident and identify the source recovery point,
   expected RPO/RTO, rehearsal owner, and an empty, access-restricted Supabase
   restore project. Confirm its identifiers differ from production.
2. Restore with the approved Supabase control-plane procedure. Keep application
   traffic, integrations, Realtime clients, printers, and outbound actions
   disabled. Give access only to the rehearsal team.
3. Measure recovery-point age and elapsed restoration time against the approved
   RPO and RTO. A provider "complete" status alone is not a pass.
4. Inspect the restored schema and migration history through Supabase MCP.
   Validate constraints, triggers, RLS, functions, and role grants against the
   reviewed repository artifacts.
5. With read-only aggregate/count and relationship checks, verify all data
   classes protected by PRD 11.14:

   - **Orders:** orders, baskets, lines, immutable sale snapshots/removals,
     lifecycle timestamps, and cancellations remain linked and internally
     consistent.
   - **Payments:** immutable payments, method snapshots, overage authorization,
     and basket/order settlement totals remain linked and reproducible.
   - **Inventory:** items, immutable movements, purchase lines, adjustments,
     waste, alerts, balances, and business origins reconcile.
   - **Production:** batches, immutable recipe versions/ingredients,
     consumption movements, and produced-stock movements reconcile.
   - **Audit history:** immutable audit events retain actor, restaurant,
     operation, target, timestamps, and before/after history without mutation.

   Use synthetic known records when content comparison is needed. Do not copy
   production row data into tickets, logs, or harness files.

6. Exercise authenticated, permission-scoped read-only application smoke tests
   against the isolated project. Confirm cross-restaurant and unauthorized
   access remain denied. Do not perform business mutations against restored
   production data.
7. Record pass/fail evidence, gaps, actual recovery point, actual restore time,
   and corrective actions. Remove access and decommission the isolated project
   under the provider-approved retention procedure after evidence is accepted.

Any missing protected data class, broken relationship, authorization failure,
or unmet RPO/RTO fails the rehearsal and blocks production approval until the
T-077 owner accepts and tracks a correction.

## Safe health signals

Use metadata-only signals; never probe by creating an order, payment, inventory
movement, production batch, or audit event in production.

1. Confirm the Vercel deployment reports Ready for the expected immutable
   commit and that an HTTPS GET of the login page returns the expected safe
   response without a TLS bypass.
2. With a dedicated least-privilege operational account approved in T-077,
   perform an authenticated read-only application request and confirm expected
   authorization. Do not use the server secret in a browser or probe script.
3. Inspect aggregate operational telemetry from T-074: `request.completed`,
   `authentication.failed`, `exception.unexpected`, `database.operation`,
   `realtime.operation`, `printer.failed`, and
   `business_event.published`. Compare latency, error, and availability signals
   with the T-077 thresholds; telemetry contains safe dimensions, not request
   bodies, query values, rows, identities, tokens, or exception text.
4. Confirm Supabase provider/database status and recent successful read
   operations. A successful page load alone does not establish database health.
5. Confirm a test client can subscribe to the expected private Realtime topic
   and recover using persisted read models. Realtime Broadcast is non-durable:
   a successful message is only a synchronization signal, and a missed message
   must be reconciled by an authorized refetch from persisted storage.

Operational telemetry is best effort and separate from immutable business
audit history. It must never replace audit events or be used as proof that a
business transaction committed. Conversely, audit history is not a health
monitor or alert pipeline.

## Incident response

1. **Declare and contain.** The T-077 incident commander records start time,
   symptoms, affected restaurant/workflow, safe telemetry dimensions, and a
   severity based on the approved policy. Use the approved contacts and
   escalation chain. Never paste payloads, credentials, customer data, or raw
   exception text into the incident channel.
2. **Protect committed data.** Determine through persisted reads whether a
   transaction committed before retrying it. Realtime and printing occur after
   commit and may fail even when the order, payment, inventory, or production
   transaction succeeded. Do not retry a business mutation based only on a
   missing Broadcast message, printer output, timeout, or HTTP 500.
3. **Classify the failing boundary.** Compare Vercel deployment status,
   request/authentication/exception telemetry, Supabase database status,
   Realtime health, and printer failure metadata. For suspected schema drift or
   data integrity, freeze affected writes and inspect through MCP.
4. **Recover safely.** Roll back only the application deployment when
   compatible. Correct the database forward through the reviewed MCP workflow.
   Use disaster restore only with the T-077 recovery authority and approved
   RPO/RTO decision.
5. **Verify and close.** Run the safe health checks, reconcile the affected
   persisted records and audit history, record the recovery timeline and
   non-secret evidence, and create corrective follow-up work. A disappearing
   alert is not sufficient closure evidence.

For a suspected credential exposure, revoke affected access through the
provider controls, follow the secret-rotation procedure, inspect safe auth and
audit evidence, and escalate under the security incident policy.

## Secret rotation

Only configuration names belong in documentation. Operators must read and
write values exclusively through the approved Supabase/Vercel secret controls.

### `SUPABASE_SECRET_KEY`

1. The T-077 security owner creates a replacement server credential in the
   correct Supabase project without displaying or recording it outside the
   provider flow.
2. Update `SUPABASE_SECRET_KEY` in the Vercel production secret store and
   create a new deployment. Verify server-side authenticated/database behavior
   with safe signals.
3. Revoke the prior credential only after the replacement deployment is
   verified. If exposure is suspected, contain/revoke according to incident
   severity, accepting controlled downtime rather than continuing exposure.
4. Confirm no secret reached browser bundles, logs, screenshots, tickets, Git,
   or harness evidence; record only rotation time, owner, credential identifier
   or fingerprint allowed by policy, deployment identifier, and result.

### `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

1. Create/identify the replacement publishable credential in the correct
   Supabase project and update `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Vercel.
2. Deploy a new immutable build because public configuration is embedded at
   build time. Verify sign-in, an authorized read, and private Realtime
   subscription/reconciliation, then retire the prior credential if supported
   and approved.

### `NEXT_PUBLIC_SUPABASE_URL`

Treat a URL change as a provider/project migration, not a routine credential
rotation. Verify the destination project, schema/migration history,
authentication configuration, authorization, restored data, Realtime topics,
and RPO/RTO evidence before rebuilding and promoting the application. This
requires a separately reviewed change and T-077 owner approval.
