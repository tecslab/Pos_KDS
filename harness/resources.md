# Project Resource Index

## Authoritative Product Sources

- `PRD/`: product behavior, domain rules, workflows, authorization, quality goals, and architecture.
- `tasks/`: atomic delivery units and canonical task status.
- `restaurantData.md`: human-provided initial operating configuration; values remain unapproved where the corresponding human checkpoint is not Done.
- `products.md`: human-provided initial catalog data.

## Design Sources

- `styleguide.md`: canonical UI tokens, interaction, accessibility, and role-specific design guidance.
- `carnalesComp.png`: canonical Carnales logo asset.
- `mockups/pos.html`: PoS layout reference.
- `mockups/kds.html`: Kitchen Display layout reference.
- `mockups/accounts.html`: payment/accounts layout reference.
- `mockups/admin.html`: administration layout reference.
- `mockups/styles.css`: shared mockup presentation.

Mockups communicate layout intent. Their sample text, timing, prices, and controls are not requirements. PRD rules and approved configuration take precedence.

## UI Routing

| Task area | Required visual context |
| --- | --- |
| PoS | Style guide, logo, PoS mockup |
| Kitchen | Style guide, logo, KDS mockup |
| Delivery | Style guide, logo; use KDS card principles where relevant |
| Payments | Style guide, logo, accounts mockup |
| Administration and reports | Style guide, logo, admin mockup |

Do not copy mockup HTML directly into production without reconciling semantics, responsiveness, accessibility, and the chosen component system.

