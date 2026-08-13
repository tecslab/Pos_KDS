# T-014 — Enforce database-level integrity and historical-record protections

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Medium |
| Type | Database |
| Dependencies | T-007, T-008, T-009, T-010, T-011, T-012, T-013 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 6.19, 11.7, 12.10–12.11 |

## Expected Outcome

- Add appropriate unique keys, foreign keys, checks, and persistence safeguards for critical invariants
- test that invalid structural data is rejected.

## Not Included

- Replacing domain-level validation or implementing workflows.

