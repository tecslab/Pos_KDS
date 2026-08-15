---
id: T-034
title: "Build the read-only audit-log view"
status: todo
priority: medium
size: small
type: feature
dependencies: [T-007, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.8 FR-ADM-007, 6.15, 10.6"
definition_of_done: harness/definition-of-done.md
---

# T-034 — Build the read-only audit-log view

## Expected Outcome

- Provide authorized filtering and viewing of immutable audit records with actor, time, entity, action, and before/after values
- make updates unavailable.

## Not Included

- Changing audit history or creating reporting exports.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
