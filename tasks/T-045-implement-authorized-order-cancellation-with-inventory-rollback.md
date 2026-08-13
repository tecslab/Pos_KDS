# T-045 — Implement authorized order cancellation with inventory rollback

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Medium |
| Type | Domain |
| Dependencies | T-010, T-012, T-014, T-016, T-018, T-019 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.1 FR-POS-009, 6.4/6.14, 9.1 exceptional transitions, BI-009/018–023 |

## Expected Outcome

- In one transaction, validate cancellation permission and state, require reason, mark the order final, create compensating inventory movements for applicable sales, audit, and emit OrderCancelled.

## Not Included

- Cancellation dialog, refunds, or deleting history.

