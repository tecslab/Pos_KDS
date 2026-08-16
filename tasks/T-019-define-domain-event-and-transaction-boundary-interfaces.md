---
id: T-019
title: "Define domain-event and transaction boundary interfaces"
status: done
priority: high
size: small
type: domain
dependencies: [T-016]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 12.11–12.12, 11.4"
definition_of_done: harness/definition-of-done.md
---

# T-019 — Define domain-event and transaction boundary interfaces

## Expected Outcome

- Define framework-independent transaction and domain-event ports
- provide a synchronous in-process implementation and tests showing business operations can publish events only after success.

## Not Included

- Supabase Realtime transport or asynchronous workers.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
