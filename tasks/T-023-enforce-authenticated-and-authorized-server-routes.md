---
id: T-023
title: "Enforce authenticated and authorized server routes"
status: todo
priority: critical
size: small
type: security
dependencies: [T-017, T-022]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 10.4, 11.5, 12.8/12.16"
definition_of_done: harness/definition-of-done.md
---

# T-023 — Enforce authenticated and authorized server routes

## Expected Outcome

- Add reusable route/use-case guards that obtain the authenticated employee profile and enforce permissions on the server
- test rejection paths.

## Not Included

- Feature endpoints themselves or UI-only hiding.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
