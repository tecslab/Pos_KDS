# T-079 — Reconcile resale inventory for pending-order modifications

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Medium |
| Type | Domain |
| Dependencies | T-012, T-014, T-016, T-031, T-038, T-042 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.1 FR-POS-006, 5.5 FR-INV-002/006/007, 6.3/6.12/6.14, BI-018–021 |

## Expected Outcome

- When a pending order's resale lines are added, reduced, removed, or reconfigured, append the necessary sale or compensating movements in the same modification transaction.
- Honor the negative-stock policy, retain immutable provenance, audit the result, and publish an inventory event after commit.

## Not Included

- Consumption of raw ingredients, direct mutation of prior movements, or changes to completed/cancelled orders.
