# T-060 — Implement inventory adjustment and waste registration

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | High |
| Estimated Size | Medium |
| Type | Domain |
| Dependencies | T-012, T-014, T-016, T-018, T-019 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.5 FR-INV-004/005/007, 6.12, 8.11, BI-018–021 |

## Expected Outcome

- Append auditable adjustment or waste movements with required reason, actor, timestamp, and configured negative-stock validation
- emit inventory events without changing prior movements.

## Not Included

- Physical-count workflow automation or UI.

