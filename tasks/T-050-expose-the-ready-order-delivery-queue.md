---
id: T-050
title: "Expose the ready-order delivery queue"
status: todo
priority: high
size: small
type: api
dependencies: [T-010, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.3 FR-WDP-001/004/005, 6.11"
definition_of_done: harness/definition-of-done.md
---

# T-050 — Expose the ready-order delivery queue

## Expected Outcome

- Provide waiter-permission read models for Ready orders with location, observation, product count, timestamps, waiting time, and supported filters.

## Not Included

- Delivery UI or state changes.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
