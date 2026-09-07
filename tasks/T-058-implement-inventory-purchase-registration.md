---
id: T-058
title: "Implement inventory purchase registration"
status: done
priority: high
size: medium
type: domain
dependencies: [T-012, T-013, T-014, T-016, T-018, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.5 FR-INV-003, 6.12, 8.9, BI-018–021"
definition_of_done: harness/definition-of-done.md
---

# T-058 — Implement inventory purchase registration

## Expected Outcome

- Within a transaction, validate a purchase, append stock-in movements with supplier/price/reference, create its operating expense, audit, and emit inventory events.

## Not Included

- Purchase forms, editing past purchases, or supplier master data.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
