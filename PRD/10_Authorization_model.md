# 10. Authorization Model

The Restaurant Management System implements **Role-Based Access Control (RBAC)**.

Authentication is delegated to **Supabase Authentication**, while authorization is enforced by the application.

Users receive permissions through roles rather than direct permission assignments.

---

# 10.1 Initial Roles

The initial release defines the following operational roles:

* Administrator
* Waiter
* Kitchen Personnel

The authorization model shall support additional roles without modifying business logic.

---

# 10.2 Permission Categories

Permissions are grouped into functional domains.

## Orders

* Create Orders
* Edit Orders
* Cancel Orders
* View Orders

---

## Kitchen

* View Kitchen Queue
* Mark Ready

---

## Delivery

* View Delivery Panel
* Mark On the Way
* Mark Delivered

---

## Payments

* Register Payment
* View Payments
* Print Receipt
* Refund Payment (Future)

---

## Inventory

* View Inventory
* Register Purchases
* Register Adjustments
* Register Waste

---

## Production

* Create Production Batch
* Edit Recipes
* View Production History

---

## Reports

* View Reports
* Export Reports

---

## Administration

* Manage Users
* Manage Roles
* Manage Products
* Manage Categories
* Manage Locations
* Configure Restaurant
* Configure Payment Methods
* Configure Printers

---

## Audit

* View Audit Log

---

# 10.3 Permission Matrix

| Permission           | Admin | Waiter | Kitchen |
| -------------------- | :---: | :----: | :-----: |
| Create Orders        |   ✓   |    ✓   |         |
| Edit Orders          |   ✓   |    ✓   |         |
| Cancel Orders        |   ✓   |        |         |
| View Orders          |   ✓   |    ✓   |    ✓    |
| View Kitchen Queue   |   ✓   |        |    ✓    |
| Mark Ready           |   ✓   |        |    ✓    |
| View Delivery Panel  |   ✓   |    ✓   |         |
| Mark On the Way      |   ✓   |    ✓   |         |
| Mark Delivered       |   ✓   |    ✓   |         |
| Register Payments    |   ✓   |    ✓   |         |
| View Inventory       |   ✓   |        |         |
| Register Purchases   |   ✓   |        |         |
| Register Waste       |   ✓   |        |         |
| Inventory Adjustment |   ✓   |        |         |
| Register Production  |   ✓   |        |         |
| Edit Recipes         |   ✓   |        |         |
| View Reports         |   ✓   |        |         |
| Export Reports       |   ✓   |        |         |
| Manage Products      |   ✓   |        |         |
| Manage Users         |   ✓   |        |         |
| View Audit           |   ✓   |        |         |

---

# 10.4 Authorization Principles

The authorization model follows these principles:

* Least privilege.
* Permissions inherited from roles.
* Centralized authorization.
* No hardcoded permissions in the UI.
* Server-side validation for every protected operation.

---

# 10.5 Future Roles

The authorization architecture shall support future roles including:

* Manager
* Cashier
* Branch Administrator
* System Administrator
* Read-only Auditor

No database redesign shall be required to introduce new roles.

---

# 10.6 Audit Requirements

Every authorization-sensitive operation shall generate an audit event.

Examples include:

* Order cancellation
* Inventory adjustment
* Product deletion
* User creation
* Role assignment
* Restaurant configuration changes

The audit shall include:

* User
* Timestamp
* Entity
* Action
* Previous values
* New values
* Source IP (when available)
