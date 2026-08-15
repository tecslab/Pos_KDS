---
id: T-077
title: "Configure and verify production backup and deployment services"
status: waiting_for_human
priority: high
size: small
type: human_checkpoint
dependencies: [T-004, T-076]
owner: human
reviewer: null
requires_human: true
architecture_required: false
prd_references:
  - "PRD 11.3/11.14, 12.4"
definition_of_done: harness/definition-of-done.md
---

# T-077 — Configure and verify production backup and deployment services

## Expected Outcome

- Configure the chosen production Supabase/Vercel projects, retention/backups, production secrets, domain policy, and monitoring destinations
- supply confirmation that restore and deployment responsibility are accepted.

## Not Included

- Writing application code, exposing secrets, or an irreversible production release.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
