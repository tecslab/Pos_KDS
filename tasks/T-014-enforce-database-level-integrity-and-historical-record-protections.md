---
id: T-014
title: "Enforce database-level integrity and historical-record protections"
status: done
priority: critical
size: medium
type: database
dependencies: [T-007, T-008, T-009, T-010, T-011, T-012, T-013]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 6.19, 11.7, 12.10–12.11"
definition_of_done: harness/definition-of-done.md
---

# T-014 — Enforce database-level integrity and historical-record protections

## Expected Outcome

- Add appropriate unique keys, foreign keys, checks, and persistence safeguards for critical invariants
- test that invalid structural data is rejected.

## Not Included

- Replacing domain-level validation or implementing workflows.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
