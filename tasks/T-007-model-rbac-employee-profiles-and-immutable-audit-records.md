---
id: T-007
title: "Model RBAC, employee profiles, and immutable audit records"
status: done
priority: critical
size: medium
type: database
dependencies: [T-006]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 7.14–7.17, 10, 11.6, 6.15"
definition_of_done: harness/definition-of-done.md
---

# T-007 — Model RBAC, employee profiles, and immutable audit records

## Expected Outcome

- Add database models and relations for application users, roles, permissions, role assignments, and immutable audit events
- constrain required relationships.

## Not Included

- Authentication UI, permission checks, or audit-log screens.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
