---
id: T-053
title: "Implement and expose the Delivered transition"
status: todo
priority: high
size: small
type: feature
dependencies: [T-010, T-016, T-018, T-019, T-020, T-023, T-052]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.3 FR-WDP-003/006, 6.1/6.11, 9.1/9.8, BI-007"
definition_of_done: harness/definition-of-done.md
---

# T-053 — Implement and expose the Delivered transition

## Expected Outcome

- Allow only a waiter to move On the Way to Delivered, capture user/timestamp, audit and publish after commit, and reject skipped states.

## Not Included

- Payment registration or partial delivery.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
