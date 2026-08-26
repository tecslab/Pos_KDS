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
