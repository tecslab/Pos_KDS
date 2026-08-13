# T-038 — Add resale-item consumption to order confirmation

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | Critical |
| Estimated Size | Medium |
| Type | Domain |
| Dependencies | T-012, T-014, T-016, T-031, T-037 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.5 FR-INV-006/007, 6.12–6.14, BI-018–021 |

## Expected Outcome

- For resale products only, create sale inventory movements as part of the confirmation transaction, enforce configured negative-stock policy, and audit resulting movements.

## Not Included

- Raw-ingredient consumption, production, or cancellation rollback.
