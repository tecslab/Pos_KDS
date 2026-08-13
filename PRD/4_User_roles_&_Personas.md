# 4. User Roles & Personas

The system uses Role-Based Access Control (RBAC).

Permissions are assigned to roles rather than directly to users.

Additional roles may be introduced in future versions without requiring changes to the authorization model.

---

## Administrator

### Description

Responsible for configuring and supervising the complete restaurant operation.

### Responsibilities

* Manage users.
* Configure products.
* Configure recipes.
* Configure inventory.
* Register purchases.
* Register production.
* Perform inventory adjustments.
* View reports.
* Review audit logs.
* Manage restaurant settings.
* Cancel orders with inventory rollback.
* Manage permissions.

### Primary Devices

* Desktop
* Tablet

---

## Waiter

### Description

Responsible for customer service from order creation through payment.

### Responsibilities

* Create orders.
* Modify pending orders.
* Manage customer account splitting.
* Monitor prepared orders.
* Mark orders as "On the Way."
* Mark orders as "Delivered."
* Register customer payments.
* View assigned operational information.

### Primary Devices

* Tablet

### Success Criteria

The waiter should complete every customer interaction with minimal screen navigation while maintaining full visibility of active tables and delivery status.

---

## Kitchen Personnel

### Description

Responsible for preparing customer orders.

### Responsibilities

* View pending kitchen orders.
* Prepare products.
* Mark orders as "Ready."
* View preparation timers.

Kitchen users should not access financial or administrative information.

### Primary Devices

* Tablet
* Kitchen display

### Success Criteria

Kitchen personnel should immediately identify:

* What must be prepared.
* Preparation priority.
* Waiting time.
* Product modifications.
* Special observations.

---

## Manager (Optional Future Role)

Although administrators currently perform management tasks, the permission model should support a dedicated Manager role in future releases.

Typical permissions may include:

* Sales reports.
* Inventory review.
* Employee supervision.
* Order cancellation approval.
* Expense approval.

Without granting access to technical system configuration.

---

## System Administrator (Future)

For multi-branch deployments, a System Administrator role may manage:

* Restaurant branches.
* Global configuration.
* User provisioning.
* System integrations.
* Operational monitoring.

This role is outside the scope of the initial release but should be considered during system design.
