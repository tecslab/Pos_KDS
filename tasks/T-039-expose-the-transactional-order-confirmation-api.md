# T-039 — Expose the transactional order-confirmation API

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Small |
| Type | API |
| Dependencies | T-020, T-023, T-037, T-038 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.1 FR-POS-007/010, 11.3–11.4, 12.8–12.12 |

## Expected Outcome

- Expose a permission-protected versioned endpoint that invokes confirmation once, publishes after commit, and returns safe business/technical errors.

## Not Included

- PoS presentation, kitchen display subscription, or physical printing.

