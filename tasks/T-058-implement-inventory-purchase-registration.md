# T-058 — Implement inventory purchase registration

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | High |
| Estimated Size | Medium |
| Type | Domain |
| Dependencies | T-012, T-013, T-014, T-016, T-018, T-019 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.5 FR-INV-003, 6.12, 8.9, BI-018–021 |

## Expected Outcome

- Within a transaction, validate a purchase, append stock-in movements with supplier/price/reference, create its operating expense, audit, and emit inventory events.

## Not Included

- Purchase forms, editing past purchases, or supplier master data.

