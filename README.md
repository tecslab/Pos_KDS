# Carnales Restaurant System

Carnales is a TypeScript Next.js modular monolith. This repository currently
contains the application skeleton and architecture boundaries only; product
features, authentication, and persistence are intentionally not part of this
foundation.

## Development

```bash
npm ci
npm run dev
```

Use `npm run build` for a production build and `npm start` to serve it. The
production build uses Next.js's supported webpack compiler for compatibility
with restricted build environments.

## Database schema and migrations

Prisma is the repository source for the PostgreSQL schema, generated client,
and reviewable SQL migration artifacts. It does not connect to or deploy to
Supabase from this project. The generated client is written to
`src/generated/prisma/` and is intentionally ignored; `npm run build` runs
`npm run db:generate` first to ensure it is current.

```bash
npm run db:schema:format
npm run db:schema:validate
npm run db:generate
```

Remote Supabase migrations are governed by ADR-001 and must use the connected
Supabase MCP, never a database connection string or a Prisma remote command.
For each future schema change:

1. Inspect the affected remote schema and Supabase migration history through
   MCP.
2. Update `prisma/schema.prisma`, then generate reviewable SQL by diffing the
   committed prior schema (or `--from-empty` for the first model-bearing
   migration) to the proposed schema:

   ```bash
   npm run db:migration:diff -- --from-schema <before.prisma> --to-schema prisma/schema.prisma --script --output prisma/migrations/<timestamp>_<mcp-name>/migration.sql
   ```

3. Review the schema and exact SQL together. The migration directory suffix
   and named MCP migration must match.
4. Apply that reviewed SQL through MCP, then verify the resulting schema and
   MCP migration history through MCP.
5. Run schema validation and client generation locally.

Supabase MCP history is authoritative because Prisma never applies remote
migrations; repository `prisma/migrations/**/migration.sql` files are the
versioned artifacts. Do not use `prisma migrate dev`, `prisma migrate deploy`,
`prisma db push`, or `prisma db execute` against the Supabase project.

### Development reference seed

After the schema migrations, apply the reviewed
`prisma/seeds/development.sql` artifact to a development database through the
connected Supabase MCP. The seed is transaction-scoped and repeatable: it
upserts reference records by stable keys and reconciles the three initial roles
to the approved permission matrix. It does not create authentication or
application user accounts, and it must not be treated as production data.

## Realtime contract

Realtime traffic uses private Supabase Broadcast topics with the stable form
`restaurant:{restaurantId}:{area}`. The supported areas are `orders`,
`kitchen`, `delivery`, `payments`, and `inventory`. Version 1 messages use the
following provider-neutral payload; `data` contains only the minimal JSON-safe
fields needed to refresh the affected read model:

```json
{
  "version": 1,
  "occurredAt": "2026-08-18T19:00:00.000Z",
  "restaurantId": "00000000-0000-0000-0000-000000000000",
  "entityId": "entity identifier",
  "entityType": "order",
  "data": {}
}
```

Broadcast event names and their ordered topic fan-out are:

| Event name                | Topics                          |
| ------------------------- | ------------------------------- |
| `order.created`           | `orders`, `kitchen`             |
| `order.modified`          | `orders`, `kitchen`             |
| `order.cancelled`         | `orders`, `kitchen`, `delivery` |
| `kitchen.status.updated`  | `kitchen`, `orders`, `delivery` |
| `delivery.status.updated` | `delivery`, `orders`            |
| `payment.completed`       | `payments`, `orders`            |
| `inventory.alert`         | `inventory`                     |

Publishing is sequential and acknowledged. Subscriptions become usable only
after provider readiness, reject malformed or cross-restaurant messages, share
one provider channel per topic, and preserve registrations across one immediate
channel replacement. A failed replacement is reported through the
provider-neutral terminal-failure callback; no polling, backoff, or outbox is
part of this contract.

## PoS ordering-context API

`GET /api/v1/pos/ordering-context` returns the active service locations and
menu data used to compose a client-only order draft. It requires an
authenticated employee with the persisted `orders.create` permission. The
response groups locations and active catalog categories by restaurant; each
active product includes its latest version identifier, price, captured tax
details, and only the options and removable ingredients configured for that
version.

The endpoint accepts no filters or request body. An authorized installation
with no configured data receives `{ "restaurants": [] }`. Authentication and
authorization failures use JSON error envelopes with status 401 and 403;
sanitized read failures use status 500. This read model is advisory draft input:
it does not persist drafts or replace server-side order-confirmation validation
and pricing.

## Active-order query API

`GET /api/v1/pos/orders` and `GET /api/v1/pos/orders/:orderId` require an
authenticated employee with the persisted `orders.view` permission. Both
endpoints are read-only and include only operational orders in `PENDING`,
`READY`, `ON_THE_WAY`, or `DELIVERED`; terminal `PAID` and non-operational
`CANCELLED` orders are excluded.

The list endpoint returns `{ "orders": [...] }`. Each order summary includes
its identifiers, order number, service location, assigned waiter, status,
notes, total, paid amount, outstanding balance, creation/update timestamps,
and basket summaries. Basket summaries include status, total, paid amount,
outstanding balance, line count, and lifecycle timestamps.

The detail endpoint returns one order directly. In addition to the summary
fields it includes order lifecycle timestamps and every basket line. A line
contains its current immutable sale snapshot and the complete ordered snapshot
revision history, including the persisted product name/version, quantities,
prices, tax details, option/removal snapshots, observations, and snapshot
timestamp. These values come from order persistence rather than the live
catalog. Paid amounts are used only to derive basket and order balances;
payment-history records and payment-method details are not exposed.

Successful reads return status 200, including `{ "orders": [] }` when no
active orders exist. Authentication and authorization failures return safe JSON
error envelopes with status 401 and 403. Detail requests return 400 for a
malformed order identifier and 404 when the identifier does not resolve to an
active order. Persistence, malformed-data, and unexpected failures return a
sanitized status 500 response.

## Kitchen pending-order queue API

`GET /api/v1/kitchen/orders` requires an authenticated employee with the
persisted `kitchen.queue.view` permission. It returns `{ "orders": [...] }`
containing only `PENDING` orders, ordered by confirmation/creation time with the
order identifier and number, service location, and creation timestamp used for
elapsed-time priority display.

Each order contains its current, non-removed preparation lines. A line includes
the persisted product name, quantity, selected options, removed ingredients,
and observations from its current immutable sale snapshot. Historical line
revisions, prices, totals, tax data, payment data, waiter details, and other
financial information are not exposed. An empty queue returns status 200;
authentication and authorization failures return safe 401 and 403 envelopes,
and persistence or unexpected failures return a sanitized status 500 response.

## Ready-order delivery queue API

`GET /api/v1/delivery/orders` requires an authenticated employee with the
persisted `delivery.panel.view` permission. It returns `{ "orders": [...] }`
containing only `READY` orders, ordered by their Ready timestamp. Each
operational, non-financial order projection includes its identifier and order
number, service-location identifier/name/type, creation and Ready timestamps,
server-calculated `waitingTimeSeconds`, active-line quantity-sum
`productCount`, and `specialObservations` from the order notes and active-line
observations. Prices, totals, balances, and payment information are not
exposed.

The endpoint accepts no request body and supports these optional exact-match
filters:

- `serviceLocationId`: a UUID exact match.
- `orderNumber`: a trimmed exact match of at most 100 characters.
- `minimumWaitingMinutes`: an integer from 0 through 1440, inclusive. It
  includes an order when `readyAt <= server now - minimumWaitingMinutes`.

Unknown, repeated, or invalid query keys/values return a sanitized 400 error.
Authorization is checked before queue composition: unauthenticated or
unauthorized requests receive safe 401 or 403 error envelopes. A successful
empty queue returns `{ "orders": [] }` with status 200; persistence and other
unexpected failures return a sanitized 500 response.

## Kitchen Ready transition API

`PATCH /api/v1/kitchen/orders/{orderId}` requires an authenticated employee
with the persisted `kitchen.ready.mark` permission. It accepts no request body
or client-selected status: the operation performs only the fixed
`PENDING → READY` transition. A successful request returns status 200 with the
financial-data-free operational Ready projection, including the server-established `readyAt` timestamp;
the order consequently disappears from the pending Kitchen queue.

The state change, lifecycle timestamp, and immutable before/after audit event
are committed atomically. After commit, one `OrderReady` domain event is
published as `kitchen.status.updated` to the `kitchen`, `orders`, and `delivery`
realtime topics. Publication failure cannot roll back or retry the committed
transition.

Authentication and permission failures return safe 401 and 403 envelopes. A
missing order returns 404, an order no longer in `PENDING` returns 409, an
invalid order identifier returns 422, and technical or post-commit publication
failures return a sanitized 500 response.

## Order-confirmation API

`POST /api/v1/pos/orders` confirms a client order draft transactionally. It
requires an authenticated employee with the persisted `orders.create`
permission and accepts `serviceLocationId`, optional `notes`, and baskets whose
lines identify product versions, quantities, selected options, removable
ingredients, and observations. Prices, totals, status, waiter identity,
timestamps, order identifiers, audit source IPs, and other authoritative fields
are always derived or validated on the server.

A successful request returns the canonical confirmed order with status 201.
The committed order is then published as an `order.created` realtime event to
the `orders` and `kitchen` topics; the endpoint does not retry confirmation if
post-commit publication fails. Authentication and permission failures return
401 and 403, invalid JSON returns 400, invalid drafts return 422, business
conflicts return 409, and technical failures return a sanitized 500 JSON error
envelope.

## Pending-order modification API

`PATCH /api/v1/pos/orders/{orderId}` modifies a confirmed order while it is
still `PENDING`. It requires an authenticated employee with the persisted
`orders.edit` permission. The request body contains `expectedUpdatedAt` and a
non-empty `operations` array. Supported operations are:

- `add`: `basketId`, `clientCorrelationId`, `productVersionId`, `quantity`,
  and optional `optionIds`, `removableIngredientIds`, and `observations`.
- `replace`: `lineId`, `expectedCurrentSnapshotId`, `quantity`, and optional
  `optionIds`, `removableIngredientIds`, and `observations`.
- `remove`: `lineId` and `expectedCurrentSnapshotId`.

`expectedUpdatedAt` protects the complete order from concurrent updates, while
each replace/remove snapshot identifier protects the targeted line revision.
The URL owns `orderId`, the authenticated session owns the actor identity, and
the server owns the audit source IP. Client-supplied identifiers, actors,
source IPs, prices, totals, statuses, revision numbers, or inventory effects
outside the operation contract are not authoritative.

A successful request atomically persists the order revisions, audit record,
and inventory reconciliation, then returns the canonical modified order with
status 200. After commit, an `order.modified` realtime event is published to
the `orders` and `kitchen` topics. Authentication and permission failures
return safe 401 and 403 envelopes, invalid JSON returns 400, a missing order
returns 404, pending-state/concurrency/configuration/inventory conflicts return
409, invalid modifications return 422, and unexpected failures return a
sanitized 500 response. Realtime publication is post-commit: if publication
fails, the endpoint returns 500 but the committed modification is not rolled
back or automatically retried.

## Quality checks

Run the complete local quality gate with:

```bash
npm run check
```

The individual commands are available when iterating on a specific concern:

- `npm run lint` checks the TypeScript and Next.js code with ESLint.
- `npm run format` validates formatting with Prettier; `npm run format:write`
  applies it.
- `npm run typecheck` performs TypeScript checking without emitting files.
- `npm run test` executes unit tests with Vitest. Domain contracts and
  framework-facing helpers have focused suites alongside their source files;
  future business rules should follow the same pattern.

Continuous integration runs the quality gate and production build for pushes
to `main` and pull requests.

## Architecture

All application code lives under `src/`:

- `app/` is the Next.js presentation and composition boundary. Pages and route
  handlers translate transport concerns and wire dependencies; they do not own
  business rules.
- `components/` contains presentation components shared by multiple screens.
- `modules/` contains the business capabilities: `orders`, `kitchen`,
  `delivery`, `payments`, `inventory`, `production`, `reports`, and
  `administration`.
- `domain/` contains framework-independent domain concepts shared across
  capabilities.
- `shared/` contains stable, non-domain-specific contracts and utilities shared
  across capabilities.
- `infrastructure/` contains replaceable adapters for external systems.
- `lib/` contains framework-facing helpers and composition utilities.

The dependency direction is inward:

```text
presentation / composition -> application contracts and use cases -> domain
                                      ^
                                      |
                  infrastructure implements inward-facing ports
```

Concrete infrastructure is wired only at composition boundaries. Capability
modules own their future application and domain behavior. Cross-module access
must use an intentional public entry point (for example, a module `index.ts`);
deep imports into another module are not allowed. These rules keep business
logic testable and independent of Next.js and external integrations.

### Error and result convention

Expected business failures are returned as `Result<T, BusinessError>` values;
they are not thrown. The shared business-error union covers invalid state
transitions, insufficient inventory, invalid payment amounts, and unauthorized
operations. Technical failures continue to throw and are handled at transport
catch boundaries. Route handlers can use `mapErrorToHttp` to translate either
kind of failure into a framework-neutral descriptor with a fixed, safe public
message, then construct the framework response at the route boundary.
