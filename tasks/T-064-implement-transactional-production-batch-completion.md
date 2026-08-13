# T-064 — Implement transactional production-batch completion

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
| PRD References | PRD 5.6 FR-PROD-002–004, 6.13, 8.10, BI-016/018–021 |

## Expected Outcome

- Validate stock against the selected historical recipe version
- atomically consume ingredients, add produced stock, persist completion history, audit, and emit inventory/production events.

## Not Included

- Production UI, cancellation, or planning automation.

