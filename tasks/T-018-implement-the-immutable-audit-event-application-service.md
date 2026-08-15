---
id: T-018
title: "Implement the immutable audit-event application service"
status: todo
priority: critical
size: small
type: domain
dependencies: [T-007, T-016]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.8 FR-ADM-007, 6.15, 10.6, BI-022–023"
definition_of_done: harness/definition-of-done.md
---

# T-018 — Implement the immutable audit-event application service

## Expected Outcome

- Provide a single application service for recording actor, entity, action, before/after values, timestamp, and optional source IP
- ensure callers cannot update or delete events.

## Not Included

- A specific business workflow or audit UI.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
