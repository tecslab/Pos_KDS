---
id: T-026
title: "Build role assignment and permission inspection administration"
status: done
priority: high
size: medium
type: feature
dependencies: [T-007, T-017, T-018, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.8 FR-ADM-002, 10.1–10.5"
definition_of_done: harness/definition-of-done.md
---

# T-026 — Build role assignment and permission inspection administration

## Expected Outcome

- Let administrators assign a role to an employee and inspect the permissions inherited by every role
- forbid direct permission grants and audit changes.

## Not Included

- Creating arbitrary new permission semantics beyond the seeded model.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
