---
id: T-080
title: "Secure Supabase invite and recovery password links"
status: done
priority: critical
size: medium
type: security_bugfix
dependencies: [T-022, T-023, T-025]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.8 FR-ADM-001, 10.6, 11.5, 12.4/12.16"
definition_of_done: harness/definition-of-done.md
---

# T-080 — Secure Supabase invite and recovery password links

## Expected Outcome

- Establish and validate the Supabase callback session for both invitation and password-recovery links before a password can be set.
- Prevent an existing browser session, including an administrator session, from receiving a password intended for the link recipient.
- Provide actionable Spanish feedback for missing, expired, invalid, or unusable links.
- Add automated coverage for an active administrator session plus an invitation link, and for a password-recovery link.

## Not Included

- Changes to Supabase project configuration, email templates, account roles, direct administrator password management, or other authentication flows.

## Priority Exception

T-080 is admitted during M1 because the user reported an active security defect that can change an administrator password. Its completed dependencies make it ready; it takes priority over the pending human checkpoints T-077 and T-078.

## Verification Exception

The required production build is accepted as an evidence-backed baseline/environment exception for this task only. The repaired source compiled and type-checked, and the full verification suite passed. Controlled builds of both this worktree and baseline `92ecd45` then failed nondeterministically during Next page-data collection in different unchanged API routes. This exception does not waive the required independent review or any authentication, authorization, test, type-check, lint, format, Prisma, harness, or diff-hygiene verification.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
