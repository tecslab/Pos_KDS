---
id: T-062
title: "Implement low-stock calculation and inventory alert events"
status: done
priority: high
size: small
type: domain
dependencies: [T-008, T-012, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.5 FR-INV-008, 3 Goal 3/4, 12.9"
definition_of_done: harness/definition-of-done.md
---

# T-062 — Implement low-stock calculation and inventory alert events

## Expected Outcome

- Calculate low-stock status from immutable movement-derived balance and configured minima
- emit inventory-alert events only when alert state changes.

## Not Included

- Inventory dashboard presentation or purchasing suggestions.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
