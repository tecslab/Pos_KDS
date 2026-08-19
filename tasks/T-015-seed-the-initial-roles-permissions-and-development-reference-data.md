---
id: T-015
title: "Seed the initial roles, permissions, and development reference data"
status: done
priority: high
size: small
type: infrastructure
dependencies: [T-007, T-003]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 10.1–10.3, 6.17, 12.15"
definition_of_done: harness/definition-of-done.md
---

# T-015 — Seed the initial roles, permissions, and development reference data

## Expected Outcome

- Create repeatable development seeds for Administrator, Waiter, Kitchen Personnel, their permission matrix, and the approved baseline configuration
- make the seed idempotent.

## Not Included

- Production user accounts or hidden hardcoded authorization.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
