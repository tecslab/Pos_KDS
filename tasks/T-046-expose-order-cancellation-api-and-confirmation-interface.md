---
id: T-046
title: "Expose order cancellation API and confirmation interface"
status: done
priority: high
size: small
type: feature
dependencies: [T-020, T-023, T-041, T-045]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.1 FR-POS-009, 6.4, 10.6"
definition_of_done: harness/definition-of-done.md
---

# T-046 — Expose order cancellation API and confirmation interface

## Expected Outcome

- Provide the permission-protected cancellation endpoint and an explicit reason/confirmation UI visible only to authorized users
- show final outcome and preserve history.

## Not Included

- Payment refunds or bulk cancellation.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
