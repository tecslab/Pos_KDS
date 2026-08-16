---
id: T-004
title: "Provision the Supabase development project and credentials"
status: waiting_for_human
priority: critical
size: small
type: human_checkpoint
dependencies: []
owner: human
reviewer: null
requires_human: true
architecture_required: false
prd_references:
  - "PRD 11.5, 12.4, 12.15–12.16"
definition_of_done: harness/definition-of-done.md
---

# T-004 — Provision the Supabase development project and credentials

## Expected Outcome

- Create the development Supabase project
- provide the project URL and publishable key; if privileged server operations require it, approve a modern server-only secret key through the project’s secret-management process. Remote database migrations use the connected Supabase MCP under ADR-001 rather than a direct database connection string.

## Not Included

- Schema migrations, user creation, or production credentials.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
