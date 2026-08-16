---
id: T-003
title: "Confirm initial restaurant operating configuration"
status: done
priority: high
size: small
type: human_checkpoint
dependencies: []
owner: human
reviewer: null
requires_human: true
architecture_required: false
prd_references:
  - "PRD 5.4, 5.8, 6.8, 6.18"
definition_of_done: harness/definition-of-done.md
---

# T-003 — Confirm initial restaurant operating configuration

## Expected Outcome

- Record the approved initial restaurant identity, tax treatment, service-location list, payment-method details, business hours, and warning thresholds
- resolve any unknown policy choices before they are seeded.

## Not Included

- Entering the configuration into the application or supplying secrets.

## Definition of Done

Inherits the [Shared Definition of Done](../harness/definition-of-done.md).

## Confirmed Initial Configuration

Confirmed by the restaurant owner through `restaurantData.md` on 2026-08-15:

- Restaurant identity: Carnales — Mexican Grill.
- Taxes: configurable; the default rate is 15% and menu prices include the applicable tax.
- Service locations: Tables 1 through 15, plus a Dispatch Window. Only the Dispatch Window permits multiple active orders.
- Payment methods: Cash, DeUna, and JEP Fast. DeUna and JEP Fast are the configured labels for the two initial bank-transfer methods.
- Business hours: 11:00–22:00.
- Kitchen thresholds: warning at 5 minutes; critical at 7 minutes.
- Delivery thresholds: warning at 6 minutes; critical at 8 minutes.
- Inventory policy: stock must never become negative.

This checkpoint records approved operating decisions only; configuration will be entered by later administration and seed tasks.
