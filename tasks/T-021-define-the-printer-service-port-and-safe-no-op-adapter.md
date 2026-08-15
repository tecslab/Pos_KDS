---
id: T-021
title: "Define the printer service port and safe no-op adapter"
status: todo
priority: medium
size: small
type: infrastructure
dependencies: [T-019]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.4 FR-PAY-008, 12.14"
definition_of_done: harness/definition-of-done.md
---

# T-021 — Define the printer service port and safe no-op adapter

## Expected Outcome

- Define printer-selection, ticket/receipt request, retry, and error-reporting interfaces
- supply a local no-op/logging adapter that never compromises a persisted transaction.

## Not Included

- A vendor-specific printer integration or hardware installation.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
