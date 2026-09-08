---
schema_version: 1
current_milestone: M1
current_task: null
current_phase: idle
next_suggested_task: T-063
last_completed_task: T-062
last_commit: pending
completed_tasks: 63
total_tasks: 79
active_blockers: []
pending_human_checkpoints:
  - T-077
  - T-078
---

# Project State

## Current Milestone

M1 — Foundation and Domain Infrastructure

## Completed

T-001 — Initialize the Next.js modular-monolith workspace (`b038e99`).

T-002 — Establish code quality and automated test tooling (`97cda38`).

T-016 — Create shared domain error and result conventions (`21460aa`).

T-019 — Define domain-event and transaction boundary interfaces (`63b45c8`).

T-003 — Confirm initial restaurant operating configuration (`6de006d`).

T-004 — Provision the Supabase development project and credentials (`38966ff`).

T-005 — Implement typed environment configuration and startup validation (commit pending; the task commit cannot self-reference in this tracked state file).

T-006 — Add Prisma database foundation and migration workflow (commit pending; the task commit cannot self-reference in this tracked state file).

T-007 — Model RBAC, employee profiles, and immutable audit records (commit pending; the task commit cannot self-reference in this tracked state file).

T-008 — Model restaurant configuration and service locations (commit pending; the task commit cannot self-reference in this tracked state file).

T-009 — Model the versioned product catalog and configurable modifications (commit pending; the task commit cannot self-reference in this tracked state file).

T-030 — Build product-category administration (commit pending; the task commit cannot self-reference in this tracked state file).

T-031 — Build product catalog and modification administration (commit pending; the task commit cannot self-reference in this tracked state file).

T-032 — Build inventory-item administration (commit pending; the task commit cannot self-reference in this tracked state file).

T-034 — Build the read-only audit-log view (commit pending; the task commit cannot self-reference in this tracked state file).

T-035 — Expose active menu and service-location data for PoS (commit pending; the task commit cannot self-reference in this tracked state file).

T-036 — Build the client-only PoS order draft composer (commit pending; the task commit cannot self-reference in this tracked state file).

T-037 — Implement the order confirmation domain use case (commit pending; the task commit cannot self-reference in this tracked state file).

T-038 — Add resale-item consumption to order confirmation (commit pending; the task commit cannot self-reference in this tracked state file).

T-039 — Expose the transactional order-confirmation API (commit pending; the task commit cannot self-reference in this tracked state file).

T-040 — Connect PoS draft confirmation and recovery feedback (commit pending; the task commit cannot self-reference in this tracked state file).

T-041 — Expose active-order queries for authorized operations (commit pending; the task commit cannot self-reference in this tracked state file).

T-042 — Implement pending-order modification domain rules (commit pending; the task commit cannot self-reference in this tracked state file).

T-079 — Reconcile resale inventory for pending-order modifications (commit pending; the task commit cannot self-reference in this tracked state file).

T-043 — Expose the pending-order modification API (commit pending; the task commit cannot self-reference in this tracked state file).

T-044 — Build the active-order editing experience (commit pending; the task commit cannot self-reference in this tracked state file).

T-045 — Implement authorized order cancellation with inventory rollback (commit pending; the task commit cannot self-reference in this tracked state file).

T-046 — Expose order cancellation API and confirmation interface (commit pending; the task commit cannot self-reference in this tracked state file).

T-047 — Expose the kitchen pending-order queue (commit pending; the task commit cannot self-reference in this tracked state file).

T-048 — Build the live Kitchen Display System queue (commit pending; the task commit cannot self-reference in this tracked state file).

T-050 — Expose the ready-order delivery queue (commit pending; the task commit cannot self-reference in this tracked state file).

T-051 — Build the Waiter Delivery Panel (commit pending; the task commit cannot self-reference in this tracked state file).

T-052 — Implement and expose the On-the-Way transition (commit pending; the task commit cannot self-reference in this tracked state file). Human-approved business configuration allows both Admin and Waiter through `delivery.on_the_way.mark`.

T-053 — Implement and expose the Delivered transition (commit pending; the task commit cannot self-reference in this tracked state file). Human-approved business configuration allows both Admin and Waiter through `delivery.delivered.mark`.

T-054 — Implement payment registration and order settlement rules (commit pending; the task commit cannot self-reference in this tracked state file). Human-approved configuration grants Administrator-only `payments.overage.authorize`; self-authorization is allowed with an immutable mandatory reason.

T-055 — Expose payment queries and registration API (commit pending; the task commit cannot self-reference in this tracked state file). Human-approved configuration grants `payments.view` to Administrator and Waiter, excludes Kitchen Personnel, and preserves permission-derived custom roles.

T-056 — Build split and partial payment experience (commit pending; the task commit cannot self-reference in this tracked state file). Includes accessible split/partial payment registration, immutable basket history, authorized overage reasons, protected realtime reconciliation, and behavioral UI coverage.

T-057 — Generate and dispatch configurable payment receipts (commit pending; the task commit cannot self-reference in this tracked state file). Receipt dispatch is permission-derived and post-payment best effort; the remote `grant_payment_receipt_print_permission` migration was verified for Administrator/Waiter grants and Kitchen exclusion.

T-058 — Implement inventory purchase registration (commit pending; the task commit cannot self-reference in this tracked state file). The remote inventory-purchase migrations and rollback probe are verified; purchases append immutable stock-ins and a matching expense atomically.

T-059 — Build inventory purchase registration UI (commit pending; the task commit cannot self-reference in this tracked state file). Includes an Admin-authorized responsive purchase form, selectable item context with visible units, success/failure feedback, and explicit accessible feedback when an action's authorized service result is rejected.

T-060 — Implement inventory adjustment and waste registration (commit pending; the task commit cannot self-reference in this tracked state file). Distinct permission-authorized operations atomically append immutable adjustment or waste origins and inventory movements with required reasons, audit provenance, configured negative-stock validation, and post-commit inventory updates; the remote migration and rollback probe are verified.

T-061 — Build inventory adjustment and waste UI (commit pending; the task commit cannot self-reference in this tracked state file). Permission-gated adjustment and waste forms clarify signed versus positive quantities, require reasons, show item units and accessible post-save balance feedback, while preserving purchase and immutable-history boundaries.

T-062 — Implement low-stock calculation and inventory alert events (commit pending; the task commit cannot self-reference in this tracked state file). Immutable movement-derived balances are compared strictly against configured minima by database reconciliation; alert history and transition snapshots change only on healthy/low state transitions, and all current movement producers emit sanitized post-commit `inventory.alert` events. The remote migration and rollback probe are verified.

## Current Task

None.

## Active Blockers

None.

## Next Suggested Task

T-063 — Build inventory balance, movement, and alert views.

## Human Checkpoints

- T-077 — Production backup and deployment configuration is a later release checkpoint.
- T-078 — Printer hardware and local print-service deployment is a later release checkpoint.

This file is a compact summary. Task front matter is canonical.
