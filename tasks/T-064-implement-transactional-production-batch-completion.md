---
id: T-064
title: "Implement transactional production-batch completion"
status: done
priority: high
size: medium
type: domain
dependencies: [T-012, T-013, T-014, T-016, T-018, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.6 FR-PROD-002–004, 6.13, 8.10, BI-016/018–021"
definition_of_done: harness/definition-of-done.md
---

# T-064 — Implement transactional production-batch completion

## Expected Outcome

- Validate stock against the selected historical recipe version
- atomically consume ingredients, add produced stock, persist completion history, audit, and emit inventory/production events.

## Not Included

- Production UI, cancellation, or planning automation.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
