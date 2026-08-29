---
id: T-039
title: "Expose the transactional order-confirmation API"
status: done
priority: critical
size: small
type: api
dependencies: [T-020, T-023, T-037, T-038]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.1 FR-POS-007/010, 11.3–11.4, 12.8–12.12"
definition_of_done: harness/definition-of-done.md
---

# T-039 — Expose the transactional order-confirmation API

## Expected Outcome

- Expose a permission-protected versioned endpoint that invokes confirmation once, publishes after commit, and returns safe business/technical errors.

## Not Included

- PoS presentation, kitchen display subscription, or physical printing.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
