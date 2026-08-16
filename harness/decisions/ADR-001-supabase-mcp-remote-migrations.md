# ADR-001 — Apply Remote Supabase Migrations Through MCP

- Status: Accepted
- Date: 2026-08-15
- Related tasks: T-004, T-006, T-007 through T-014, T-020, T-022
- PRD references: PRD 12.4, 12.10–12.11

## Context

Carnales uses Supabase for its PostgreSQL database, authentication, and Realtime services. The development project is managed through the connected Supabase MCP. Direct database connection credentials are sensitive and are not required for the browser client.

## Decision

- Browser/client configuration uses only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Privileged server operations use a modern Supabase secret key (`sb_secret_...`) only when required, sourced from approved secret management and never committed or exposed to client code. Do not introduce legacy `anon` or `service_role` keys for new work.
- Remote schema migrations for the Supabase development project must be applied through the connected Supabase MCP. Before an additive or destructive remote schema change, inspect the relevant existing schema; apply a named migration through MCP; then verify the resulting schema and migration history through MCP.
- Prisma remains the repository's schema/client and versioned-migration artifact tool where required by a task, but agents must not use a direct database URL or run Prisma's remote deployment commands to apply changes to Supabase. The task plan must state how the Prisma artifact corresponds to the MCP-applied migration.

## Consequences

- No direct database connection string is included in `.env.example` or required to complete the client configuration.
- Migration tasks are High complexity and must treat MCP application as a remote state change, with reviewable SQL/artifacts and post-application verification.
- T-006 must document this MCP-based remote application workflow alongside any local Prisma generation commands.
- Server-only key material remains outside Git and task history.

## Alternatives Considered

- Apply remote migrations with Prisma using a database URL: rejected because the project standard is Supabase MCP for remote migration application and it would require broader direct-credential handling.
- Use legacy `anon` and `service_role` keys: rejected for new work because Supabase recommends publishable and secret keys.
