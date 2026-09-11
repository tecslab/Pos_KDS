---
id: T-071
title: "Add end-to-end coverage for the core order lifecycle"
status: done
priority: critical
size: medium
type: testing
dependencies: [T-040, T-044, T-046, T-048, T-049, T-051, T-052, T-053, T-056]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 8.1–8.8, 9.1–9.3, 12.18"
definition_of_done: harness/definition-of-done.md
---

# T-071 — Add end-to-end coverage for the core order lifecycle

## Expected Outcome

- Add E2E tests for sign-in, draft, confirmation, kitchen Ready, delivery transitions, split/partial payment, and cancellation authorization
- cover realtime-visible outcomes where testable.

## Not Included

- Production load testing or hardware printing.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
