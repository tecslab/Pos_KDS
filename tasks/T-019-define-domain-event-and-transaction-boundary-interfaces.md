# T-019 — Define domain-event and transaction boundary interfaces

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | High |
| Estimated Size | Small |
| Type | Domain |
| Dependencies | T-016 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 12.11–12.12, 11.4 |

## Expected Outcome

- Define framework-independent transaction and domain-event ports
- provide a synchronous in-process implementation and tests showing business operations can publish events only after success.

## Not Included

- Supabase Realtime transport or asynchronous workers.

