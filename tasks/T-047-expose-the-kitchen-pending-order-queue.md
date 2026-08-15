---
id: T-047
title: "Expose the kitchen pending-order queue"
status: todo
priority: critical
size: small
type: api
dependencies: [T-010, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.2 FR-KDS-001/002, 6.10"
definition_of_done: harness/definition-of-done.md
---

# T-047 — Expose the kitchen pending-order queue

## Expected Outcome

- Provide a kitchen-permission read model containing pending orders in confirmation order, lines, modifications, observations, location, creation time, and priority inputs.

## Not Included

- Kitchen UI or Ready transition.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
