---
id: T-010
title: "Model orders, baskets, lines, and lifecycle timestamps"
status: done
priority: critical
size: medium
type: database
dependencies: [T-006]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 7.3–7.5, 9.1/9.3/9.8, BI-001–011"
definition_of_done: harness/definition-of-done.md
---

# T-010 — Model orders, baskets, lines, and lifecycle timestamps

## Expected Outcome

- Add models for persisted orders, customer baskets, order lines, immutable sale snapshots, cancellation data, and all lifecycle timestamps
- represent the supported states.

## Not Included

- Order use cases, payment records, or UI.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
