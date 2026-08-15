---
id: T-037
title: "Implement the order confirmation domain use case"
status: todo
priority: critical
size: medium
type: domain
dependencies: [T-008, T-009, T-010, T-014, T-016, T-018, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.1 FR-POS-007/008, 6.1–6.2, 9.1, BI-001–005/010–011/015"
definition_of_done: harness/definition-of-done.md
---

# T-037 — Implement the order confirmation domain use case

## Expected Outcome

- Within one transaction, validate a non-empty draft and active location availability, allocate a unique number, snapshot pricing/configuration, persist Pending order/baskets/lines, audit, and emit OrderConfirmed.

## Not Included

- HTTP handling, a PoS button, sale inventory consumption, or printer transport.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
