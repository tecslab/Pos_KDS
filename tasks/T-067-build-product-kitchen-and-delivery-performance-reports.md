---
id: T-067
title: "Build product, kitchen, and delivery performance reports"
status: done
priority: medium
size: medium
type: feature
dependencies: [T-009, T-010, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.7 FR-REP-002–004, 3 KPI order/kitchen/waiter, 9.8"
definition_of_done: harness/definition-of-done.md
---

# T-067 — Build product, kitchen, and delivery performance reports

## Expected Outcome

- Provide persisted-data reports for product/category sales, preparation times/peaks, and delivery timings/bottlenecks
- label them as operational metrics.

## Not Included

- Employee disciplinary scoring or exports.

## Approved Historical Category Policy

For pre-existing sale snapshots that lack transaction-time category data, category reporting must group the sale under the exact label **Unattributed historical category**. The report must never infer that legacy category from the mutable current catalog. Future sales must persist a category snapshot at transaction time, so later product recategorization cannot alter historical category reporting.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
