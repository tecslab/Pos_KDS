---
id: T-011
title: "Model payments and immutable payment history"
status: todo
priority: critical
size: small
type: database
dependencies: [T-006, T-010]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 7.12, 5.4, 9.2, BI-012–014"
definition_of_done: harness/definition-of-done.md
---

# T-011 — Model payments and immutable payment history

## Expected Outcome

- Add payment records linked to exactly one basket with amount, method, actor, reference, comments, and timestamps
- protect payment history from destructive updates.

## Not Included

- Payment processing logic or receipt printing.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
