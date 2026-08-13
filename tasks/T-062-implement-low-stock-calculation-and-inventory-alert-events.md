# T-062 — Implement low-stock calculation and inventory alert events

## Metadata

| Field | Value |
| --- | --- |
| Status | Todo |
| Priority | High |
| Estimated Size | Small |
| Type | Domain |
| Dependencies | T-008, T-012, T-019 |
| Owner | AI |
| Reviewer | AI Reviewer |
| Requires Human | No |
| PRD References | PRD 5.5 FR-INV-008, 3 Goal 3/4, 12.9 |

## Expected Outcome

- Calculate low-stock status from immutable movement-derived balance and configured minima
- emit inventory-alert events only when alert state changes.

## Not Included

- Inventory dashboard presentation or purchasing suggestions.

