---
id: T-045
title: "Implement authorized order cancellation with inventory rollback"
status: todo
priority: critical
size: medium
type: domain
dependencies: [T-010, T-012, T-014, T-016, T-018, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.1 FR-POS-009, 6.4/6.14, 9.1 exceptional transitions, BI-009/018–023"
definition_of_done: harness/definition-of-done.md
---

# T-045 — Implement authorized order cancellation with inventory rollback

## Expected Outcome

- In one transaction, validate cancellation permission and state, require reason, mark the order final, create compensating inventory movements for applicable sales, audit, and emit OrderCancelled.

## Not Included

- Cancellation dialog, refunds, or deleting history.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
