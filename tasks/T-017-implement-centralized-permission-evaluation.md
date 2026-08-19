---
id: T-017
title: "Implement centralized permission evaluation"
status: done
priority: critical
size: small
type: domain
dependencies: [T-007, T-016]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 10.4–10.5, 6.17, BI-024–025, 12.16"
definition_of_done: harness/definition-of-done.md
---

# T-017 — Implement centralized permission evaluation

## Expected Outcome

- Implement role-derived permission evaluation with no direct user grants
- unit-test the initial matrix and future-role extensibility.

## Not Included

- Supabase session retrieval or route middleware.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
