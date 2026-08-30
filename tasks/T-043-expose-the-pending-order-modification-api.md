---
id: T-043
title: "Expose the pending-order modification API"
status: done
priority: high
size: small
type: api
dependencies: [T-020, T-023, T-042, T-079]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.1 FR-POS-006/010, 12.8–12.12"
definition_of_done: harness/definition-of-done.md
---

# T-043 — Expose the pending-order modification API

## Expected Outcome

- Add a protected versioned update endpoint with safe concurrency/error handling and post-commit realtime publication.

## Not Included

- PoS editing screen.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
