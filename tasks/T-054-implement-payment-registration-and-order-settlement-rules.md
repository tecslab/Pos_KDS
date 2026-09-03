---
id: T-054
title: "Implement payment registration and order settlement rules"
status: done
priority: critical
size: medium
type: domain
dependencies: [T-010, T-011, T-014, T-016, T-018, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.4 FR-PAY-002–007, 6.9, 9.2/9.3, BI-008/012–014"
definition_of_done: harness/definition-of-done.md
---

# T-054 — Implement payment registration and order settlement rules

## Expected Outcome

- Within a transaction, validate a delivered order and selected basket, prevent overpayment unless privileged policy permits, append an immutable payment, recalculate basket balance, transition to Paid only when every basket is settled, audit, and emit PaymentCompleted.

## Not Included

- Payment API, UI, refunds, or printing.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
