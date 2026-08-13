# T-020 — Implement the Supabase Realtime event adapter

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | High |
| Estimated Size | Medium |
| Type | Infrastructure |
| Dependencies | T-005, T-019 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5 intro, 11.1 NFR-003, 12.9 |

## Expected Outcome

- Map domain events to documented realtime channels and event payloads
- implement publish/subscribe infrastructure without exposing Supabase APIs to domain code.

## Not Included

- Feature-specific subscriptions or polling fallback.

