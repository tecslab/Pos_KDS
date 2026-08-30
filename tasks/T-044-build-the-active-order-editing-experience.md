---
id: T-044
title: "Build the active-order editing experience"
status: done
priority: high
size: medium
type: ui
dependencies: [T-036, T-041, T-043]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.1 FR-POS-006, 6.3, 11.8"
definition_of_done: harness/definition-of-done.md
---

# T-044 — Build the active-order editing experience

## Expected Outcome

- Let waiters load a pending order, make allowed line/basket/modification changes, review the result, and receive synchronization feedback without exposing forbidden states.

## Not Included

- Order cancellation or payments.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
