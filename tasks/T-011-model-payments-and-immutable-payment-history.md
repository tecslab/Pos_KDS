# T-011 — Model payments and immutable payment history

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Small |
| Type | Database |
| Dependencies | T-006, T-010 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 7.12, 5.4, 9.2, BI-012–014 |

## Expected Outcome

- Add payment records linked to exactly one basket with amount, method, actor, reference, comments, and timestamps
- protect payment history from destructive updates.

## Not Included

- Payment processing logic or receipt printing.

