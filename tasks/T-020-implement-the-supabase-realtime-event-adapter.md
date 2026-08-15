---
id: T-020
title: "Implement the Supabase Realtime event adapter"
status: todo
priority: high
size: medium
type: infrastructure
dependencies: [T-005, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5 intro, 11.1 NFR-003, 12.9"
definition_of_done: harness/definition-of-done.md
---

# T-020 — Implement the Supabase Realtime event adapter

## Expected Outcome

- Map domain events to documented realtime channels and event payloads
- implement publish/subscribe infrastructure without exposing Supabase APIs to domain code.

## Not Included

- Feature-specific subscriptions or polling fallback.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
