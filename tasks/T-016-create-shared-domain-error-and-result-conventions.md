---
id: T-016
title: "Create shared domain error and result conventions"
status: done
priority: high
size: small
type: domain
dependencies: [T-002]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 12.13, 11.9"
definition_of_done: harness/definition-of-done.md
---

# T-016 — Create shared domain error and result conventions

## Expected Outcome

- Define framework-independent business-error types, typed results, and a consistent HTTP-error mapping contract
- cover invalid transition, insufficient inventory, invalid payment, and unauthorized cases.

## Not Included

- Feature-specific validation.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
