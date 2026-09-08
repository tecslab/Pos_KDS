---
id: T-060
title: "Implement inventory adjustment and waste registration"
status: done
priority: high
size: medium
type: domain
dependencies: [T-012, T-014, T-016, T-018, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.5 FR-INV-004/005/007, 6.12, 8.11, BI-018–021"
definition_of_done: harness/definition-of-done.md
---

# T-060 — Implement inventory adjustment and waste registration

## Expected Outcome

- Append auditable adjustment or waste movements with required reason, actor, timestamp, and configured negative-stock validation
- emit inventory events without changing prior movements.

## Not Included

- Physical-count workflow automation or UI.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
