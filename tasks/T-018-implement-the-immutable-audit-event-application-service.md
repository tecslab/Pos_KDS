# T-018 — Implement the immutable audit-event application service

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Small |
| Type | Domain |
| Dependencies | T-007, T-016 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.8 FR-ADM-007, 6.15, 10.6, BI-022–023 |

## Expected Outcome

- Provide a single application service for recording actor, entity, action, before/after values, timestamp, and optional source IP
- ensure callers cannot update or delete events.

## Not Included

- A specific business workflow or audit UI.

