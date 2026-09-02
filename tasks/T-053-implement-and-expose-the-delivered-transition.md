---
id: T-053
title: "Implement and expose the Delivered transition"
status: done
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

- Allow an authorized Admin or Waiter to move On the Way to Delivered, capture user/timestamp, audit and publish after commit, and reject skipped states.

## Not Included

- Payment registration or partial delivery.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).

## Approved Business Configuration

The human explicitly resolved the Delivered-transition actor policy: both Administrator and Waiter may perform On the Way → Delivered through the established `delivery.delivered.mark` permission. This approved configuration takes precedence over conflicting PRD wording.
