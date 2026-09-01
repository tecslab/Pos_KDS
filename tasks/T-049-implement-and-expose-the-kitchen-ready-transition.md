---
id: T-049
title: "Implement and expose the Kitchen Ready transition"
status: done
priority: critical
size: small
type: feature
dependencies: [T-010, T-016, T-018, T-019, T-020, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.2 FR-KDS-005, 6.1/6.10, 9.1/9.7/9.8"
definition_of_done: harness/definition-of-done.md
---

# T-049 — Implement and expose the Kitchen Ready transition

## Expected Outcome

- Allow only Kitchen-authorized users to transition Pending to Ready, timestamp it, audit it, publish OrderReady after commit, and remove it from the pending queue.

## Not Included

- Manual kitchen prioritization or delivery UI.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
