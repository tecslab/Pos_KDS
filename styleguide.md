# Carnales Product Style Guide

This guide defines a professional interface direction for the new restaurant management system. The logo colors remain part of the brand, but they are not the main UI palette. The product should feel calm, fast, legible, and operational for waiters, kitchen staff, and administrators working under time pressure.

## Design Principles

- **Operational clarity first.** Screens must make the next action obvious without decorative noise.
- **High scan speed.** Waiters and kitchen staff should identify table, order age, item quantity, and exceptions in under a second.
- **Brand restraint.** Use logo green/red/yellow as accents and status cues, not as broad backgrounds.
- **Touch-friendly density.** Controls must be large enough for restaurant use, but layouts should still show many orders/products at once.
- **Accessible contrast.** Text and controls must meet strong contrast targets in bright kitchens and on lower-quality tablets.
- **Consistent status language.** Color, labels, and placement must communicate the same meaning across PoS, KDS, accounts, and admin.

## Color Tokens

### Core Neutrals

Use neutrals for most surfaces, text, borders, and structure.

| Token | Hex | Usage |
| --- | --- | --- |
| `--color-bg` | `#F6F7F4` | App background |
| `--color-surface` | `#FFFFFF` | Panels, cards, menus |
| `--color-surface-muted` | `#EEF1ED` | Secondary panels, table headers |
| `--color-border` | `#D7DDD5` | Dividers and control borders |
| `--color-border-strong` | `#AEB8AA` | Active control borders |
| `--color-text` | `#1F2521` | Primary text |
| `--color-text-muted` | `#687066` | Secondary text |
| `--color-text-inverse` | `#FFFFFF` | Text on dark/action backgrounds |

### Brand Accents

These colors are derived from the logo, but they must be used sparingly.

| Token | Hex | Usage |
| --- | --- | --- |
| `--brand-green` | `#0B6B2B` | Primary action, selected table, positive confirmation |
| `--brand-red` | `#D8231F` | Destructive actions, overdue kitchen orders |
| `--brand-yellow` | `#D9BE72` | Logo accent only; avoid as broad UI background |
| `--brand-black` | `#111111` | Logo text only; use `--color-text` in UI |

### Semantic Status

Do not use raw brand colors directly for every state. Use semantic tokens.

| Token | Hex | Usage |
| --- | --- | --- |
| `--status-new` | `#2F7D46` | New or normal pending order |
| `--status-warning` | `#B7791F` | Order approaching target time |
| `--status-critical` | `#B42318` | Late order, blocked workflow, destructive confirmation |
| `--status-paid` | `#2563EB` | Paid/closed account |
| `--status-info` | `#475569` | Neutral informational state |
| `--status-disabled` | `#9AA39A` | Disabled or unavailable |

### Status Backgrounds

| Token | Hex | Usage |
| --- | --- | --- |
| `--status-new-bg` | `#E7F4EA` | Normal KDS card badge |
| `--status-warning-bg` | `#FFF4D7` | Warning card/badge |
| `--status-critical-bg` | `#FEE4E2` | Critical card/badge |
| `--status-paid-bg` | `#EAF1FF` | Paid account badge |

## Typography

Use a system font stack for performance and platform familiarity:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

| Token | Size | Weight | Line Height | Usage |
| --- | --- | --- | --- | --- |
| `--font-xs` | `12px` | 500 | 16px | Metadata, helper text |
| `--font-sm` | `14px` | 500 | 20px | Secondary UI text |
| `--font-md` | `16px` | 500 | 24px | Default body/control text |
| `--font-lg` | `20px` | 650 | 28px | Card titles, totals |
| `--font-xl` | `28px` | 700 | 36px | Screen titles, KDS timer emphasis |

Rules:
- Do not use script or novelty fonts in the app UI.
- Use numeric tabular figures for prices, quantities, timers, and order numbers.
- Keep all letter spacing at `0`.

## Spacing

Use a 4px base grid.

| Token | Value |
| --- | --- |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |

## Shape And Elevation

| Token | Value | Usage |
| --- | --- | --- |
| `--radius-sm` | `4px` | Badges, compact controls |
| `--radius-md` | `6px` | Buttons, inputs |
| `--radius-lg` | `8px` | Cards and panels |
| `--shadow-sm` | `0 1px 2px rgba(16, 24, 20, 0.08)` | Raised control |
| `--shadow-md` | `0 8px 24px rgba(16, 24, 20, 0.12)` | Modal or focused panel |

Avoid rounded pill buttons except for small status badges.

## Layout Tokens

| Token | Value | Usage |
| --- | --- | --- |
| `--sidebar-width` | `280px` | Product category or admin nav |
| `--topbar-height` | `64px` | App header |
| `--touch-target` | `48px` | Minimum interactive height |
| `--kds-card-min` | `280px` | Minimum KDS card width |
| `--content-max` | `1440px` | Admin/dashboard max width |

## Component Guidance

### App Header

- White or muted neutral surface.
- Small logo at left; do not use a large branded banner inside operational screens.
- Show current station/user, date/time, and online/printer/database status where relevant.

### Buttons

- Primary action: green.
- Secondary action: neutral border.
- Destructive action: red, only for delete/cancel.
- Disabled buttons must be visibly muted and non-interactive.
- Minimum size: `48px` high on touch screens.

### Product Buttons

- Use neutral buttons by default.
- Selected product/category uses green border and soft green background.
- Quantity controls should use `-`, value, `+` with stable width.
- Product modifications should use labeled chips or icon+label toggles, not color alone.

### Order Cards

- Header must show order number, table, and elapsed time.
- Quantity should be the first visual anchor for each line item.
- Exceptions such as `Sin Cebolla` or `Dividido` must be visually distinct.
- Color status should appear as a left border or small badge, not a full saturated card background.

### KDS

- KDS can use a darker top bar only if content cards remain high contrast.
- Elapsed time:
  - `0:00-0:29`: normal green status.
  - `0:30-0:59`: warning status.
  - `1:00+`: critical status.
- “Listo” must be large, persistent, and placed at the bottom of each card.
- Avoid showing prices on KDS unless kitchen needs them; prioritize preparation details.

### Accounts

- Accounts should show total prominently, with optional per-customer subtotals.
- Payment/close action should be separate from kitchen-ready action.
- If payment methods are added, use a clear segmented control: Cash, Card, Transfer.

### Admin

- Use denser tables and restrained charts.
- Low-stock alerts should use warning status, not logo red unless critical.
- Expense and inventory forms should use clear labels, units, and validation messages.

## Interaction States

| State | Visual Treatment |
| --- | --- |
| Hover | Slight surface tint and stronger border |
| Focus | 2px green outline with 2px offset |
| Selected | Green border, soft green background, bold label |
| Disabled | Muted text, muted border, no shadow |
| Loading | Keep layout stable; replace action label with spinner + short verb |
| Error | Red border, error message below field |

## UX Requirements By Role

### Waiters

- Fast table switching and product entry.
- Large touch targets.
- Clear order review before confirmation.
- Visible total at all times.
- Easy removal/modification before confirmation.
- Prevent accidental duplicate confirmation.

### Kitchen Personnel

- Minimal navigation.
- Large order cards with table, age, quantity, and modifications.
- Color status for age escalation.
- One clear completion action per order.
- New orders should appear without a manual refresh.

### Administrators

- Accurate totals and stock movement history.
- Forms must clarify whether quantity is being added or set.
- Inventory units must be visible beside every quantity.
- Expense values should consistently display as currency.

## Mockups

Static mockups are available in:

- [PoS Mockup](mockups/pos.html)
- [Kitchen Display Mockup](mockups/kds.html)
- [Accounts Mockup](mockups/accounts.html)
- [Admin Mockup](mockups/admin.html)

