---
id: T-038
title: "Add resale-item consumption to order confirmation"
status: done
priority: critical
size: medium
type: domain
dependencies: [T-012, T-014, T-016, T-031, T-037]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.5 FR-INV-006/007, 6.12–6.14, BI-018–021"
definition_of_done: harness/definition-of-done.md
---

# T-038 — Add resale-item consumption to order confirmation

## Expected Outcome

- For resale products only, create sale inventory movements as part of the confirmation transaction, enforce configured negative-stock policy, and audit resulting movements.

## Not Included

- Raw-ingredient consumption, production, or cancellation rollback.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
