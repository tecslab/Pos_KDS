# T-049 — Implement and expose the Kitchen Ready transition

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Small |
| Type | Feature |
| Dependencies | T-010, T-016, T-018, T-019, T-020, T-023 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.2 FR-KDS-005, 6.1/6.10, 9.1/9.7/9.8 |

## Expected Outcome

- Allow only Kitchen-authorized users to transition Pending to Ready, timestamp it, audit it, publish OrderReady after commit, and remove it from the pending queue.

## Not Included

- Manual kitchen prioritization or delivery UI.

