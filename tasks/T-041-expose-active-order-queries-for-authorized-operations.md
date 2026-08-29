---
id: T-041
title: "Expose active-order queries for authorized operations"
status: done
priority: high
size: small
type: api
dependencies: [T-010, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.1 FR-POS-006, 5.4 FR-PAY-001, 6.16"
definition_of_done: harness/definition-of-done.md
---

# T-041 — Expose active-order queries for authorized operations

## Expected Outcome

- Expose role-filtered persisted active-order detail and list read models, including baskets, lines, status, balances, and historical snapshots.

## Not Included

- Order changes, payments, or reports.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
