---
id: T-035
title: "Expose active menu and service-location data for PoS"
status: todo
priority: critical
size: small
type: api
dependencies: [T-008, T-009, T-023]
owner: ai
reviewer: ai_reviewer
requires_human: false
architecture_required: true
prd_references:
  - "PRD 5.1 FR-POS-001–004, 12.8"
definition_of_done: harness/definition-of-done.md
---

# T-035 — Expose active menu and service-location data for PoS

## Expected Outcome

- Provide permission-protected read models/endpoints for active locations, categories, products, allowed modifications, and price/tax details needed to compose an order.

## Not Included

- Draft persistence or order confirmation.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).
