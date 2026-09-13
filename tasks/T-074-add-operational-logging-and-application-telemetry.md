---
id: T-074
title: "Add operational logging and application telemetry"
status: done
priority: high
size: small
type: infrastructure
dependencies: [T-005, T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 11.10, 12.17"
definition_of_done: harness/definition-of-done.md
---

# T-074 — Add operational logging and application telemetry

## Expected Outcome

- Implement structured error/warning logging with request latency, error rate, database/realtime health, printer failure, and business-event metric hooks
- exclude sensitive values.

## Not Included

- Replacing the audit log or subscribing a production monitoring vendor.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
