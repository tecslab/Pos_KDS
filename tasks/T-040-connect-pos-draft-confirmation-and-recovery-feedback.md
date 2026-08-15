---
id: T-040
title: "Connect PoS draft confirmation and recovery feedback"
status: todo
priority: critical
size: small
type: ui
dependencies: [T-021, T-036, T-039]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: false
prd_references:
  - "PRD 5.1 FR-POS-007–010, 11.1 NFR-002, 11.3, 11.8"
definition_of_done: harness/definition-of-done.md
---

# T-040 — Connect PoS draft confirmation and recovery feedback

## Expected Outcome

- Add the confirmation action with pending/success/failure feedback, duplicate-submit protection, draft reset only after persistence, and non-blocking kitchen-ticket request through the printer port.

## Not Included

- Vendor printing or confirmed-order editing.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
