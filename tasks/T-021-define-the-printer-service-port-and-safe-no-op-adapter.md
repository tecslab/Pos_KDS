# T-021 — Define the printer service port and safe no-op adapter

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Medium |
| Estimated Size | Small |
| Type | Infrastructure |
| Dependencies | T-019 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.4 FR-PAY-008, 12.14 |

## Expected Outcome

- Define printer-selection, ticket/receipt request, retry, and error-reporting interfaces
- supply a local no-op/logging adapter that never compromises a persisted transaction.

## Not Included

- A vendor-specific printer integration or hardware installation.

