# T-037 — Implement the order confirmation domain use case

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Medium |
| Type | Domain |
| Dependencies | T-008, T-009, T-010, T-014, T-016, T-018, T-019 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.1 FR-POS-007/008, 6.1–6.2, 9.1, BI-001–005/010–011/015 |

## Expected Outcome

- Within one transaction, validate a non-empty draft and active location availability, allocate a unique number, snapshot pricing/configuration, persist Pending order/baskets/lines, audit, and emit OrderConfirmed.

## Not Included

- HTTP handling, a PoS button, sale inventory consumption, or printer transport.

