---
id: T-052
title: "Implement and expose the On-the-Way transition"
status: todo
priority: high
size: small
type: feature
dependencies: [T-010, T-016, T-018, T-019, T-020, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.3 FR-WDP-002, 6.1/6.11, 9.1/9.8"
definition_of_done: harness/definition-of-done.md
---

# T-052 — Implement and expose the On-the-Way transition

## Expected Outcome

- Allow only a waiter to move Ready to On the Way, record the collecting user and timestamp, audit it, and publish the update after commit.

## Not Included

- Delivery dashboard screen changes.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
