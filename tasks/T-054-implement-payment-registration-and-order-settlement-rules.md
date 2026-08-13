# T-054 — Implement payment registration and order settlement rules

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Medium |
| Type | Domain |
| Dependencies | T-010, T-011, T-014, T-016, T-018, T-019 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.4 FR-PAY-002–007, 6.9, 9.2/9.3, BI-008/012–014 |

## Expected Outcome

- Within a transaction, validate a delivered order and selected basket, prevent overpayment unless privileged policy permits, append an immutable payment, recalculate basket balance, transition to Paid only when every basket is settled, audit, and emit PaymentCompleted.

## Not Included

- Payment API, UI, refunds, or printing.

