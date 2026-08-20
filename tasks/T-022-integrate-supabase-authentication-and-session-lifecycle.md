---
id: T-022
title: "Integrate Supabase Authentication and session lifecycle"
status: done
priority: critical
size: medium
type: feature
dependencies: [T-004, T-005, T-007]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.8 FR-ADM-001, 10, 11.5, 12.4/12.16"
definition_of_done: harness/definition-of-done.md
---

# T-022 — Integrate Supabase Authentication and session lifecycle

## Expected Outcome

- Implement Supabase sign-in/sign-out and server-recognized sessions
- redirect unauthenticated users appropriately
- never handle passwords directly.

## Not Included

- User invitations, profile activation, or role assignment.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
