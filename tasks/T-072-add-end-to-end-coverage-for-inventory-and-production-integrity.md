---
id: T-072
title: "Add end-to-end coverage for inventory and production integrity"
status: done
priority: critical
size: medium
type: testing
dependencies: [T-059, T-061, T-063, T-065]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.5–5.6, 8.9–8.11, BI-016/018–021, 12.18"
definition_of_done: harness/definition-of-done.md
---

# T-072 — Add end-to-end coverage for inventory and production integrity

## Expected Outcome

- Add integration/E2E coverage for purchase, waste, adjustment, resale sale, cancellation rollback, and production
- prove movement immutability and no-negative-stock behavior.

## Not Included

- Physical stock reconciliation or supplier integrations.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
