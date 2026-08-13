# 8. User Workflows

This chapter describes the primary operational workflows supported by the Restaurant Management System.

These workflows represent the expected interactions between users and the application during daily restaurant operations.

---

# 8.1 Dine-In Order

### Actors

* Waiter
* Kitchen Personnel

### Preconditions

* The waiter is authenticated.
* A dining table is available.

### Workflow

1. The waiter selects a table.
2. The waiter creates a new order.
3. Products are assigned to one or more customer baskets.
4. Product modifications are configured.
5. The waiter reviews the order summary.
6. The waiter confirms the order.
7. The order is persisted.
8. The kitchen receives the order.
9. The kitchen prepares the products.
10. The kitchen marks the order as **Ready**.
11. A waiter collects the food and marks it **On the Way**.
12. The waiter delivers all products.
13. The waiter marks the order **Delivered**.
14. Customers complete payment.
15. The order reaches the **Paid** state.

---

# 8.2 Takeout Order

### Actors

* Waiter
* Kitchen Personnel

### Workflow

1. The waiter selects the Dispatch Window.
2. The order is created.
3. The order is confirmed.
4. Kitchen prepares the products.
5. Kitchen marks the order **Ready**.
6. The waiter hands the order to the customer.
7. The waiter marks the order **Delivered**.
8. Payment is completed.

Because the Dispatch Window supports multiple simultaneous orders, several active orders may coexist for the same service location.

---

# 8.3 Split Account Workflow

### Actors

* Waiter

### Workflow

1. The waiter creates an order.
2. Products are assigned to individual customer baskets.
3. Shared products are assigned to the General basket.
4. The order is confirmed.
5. Each customer pays independently.
6. The order becomes **Paid** only after every basket has been fully settled.

---

# 8.4 Order Modification Workflow

### Actors

* Waiter

### Workflow

1. The waiter opens an active order.
2. Products are added, removed, or modified.
3. The updated order is saved.
4. Audit records are generated.
5. Kitchen displays are updated automatically.
6. Reports remain synchronized.

---

# 8.5 Order Cancellation Workflow

### Actors

* Administrator
* Manager (future)

### Workflow

1. An authorized user requests cancellation.
2. The system requests a cancellation reason.
3. Permissions are validated.
4. Inventory rollback is executed.
5. Audit events are generated.
6. Historical records are preserved.

Cancelled orders never disappear from reporting.

---

# 8.6 Kitchen Workflow

### Actors

* Kitchen Personnel

### Workflow

1. New orders appear automatically.
2. Kitchen personnel review products.
3. Product modifications are reviewed.
4. Food is prepared.
5. The order is marked **Ready**.
6. Waiters receive an immediate notification.

---

# 8.7 Delivery Workflow

### Actors

* Waiter

### Workflow

1. The Waiter Delivery Panel displays all Ready orders.
2. The waiter collects an order.
3. The waiter marks it **On the Way**.
4. The customer receives every product.
5. The waiter marks the order **Delivered**.

The system records timestamps for each transition to support operational KPIs.

---

# 8.8 Payment Workflow

### Actors

* Waiter

### Workflow

1. The waiter opens the payment screen.
2. The outstanding customer baskets are displayed.
3. The customer selects a payment method.
4. Payment is registered.
5. The remaining balance is recalculated.
6. If all baskets are fully paid, the order transitions to **Paid**.

---

# 8.9 Inventory Purchase Workflow

### Actors

* Administrator

### Workflow

1. A supplier delivers inventory.
2. The administrator registers the purchase.
3. Inventory stock increases.
4. An expense record is generated.
5. Inventory movements are recorded.
6. Audit records are generated.

---

# 8.10 Production Workflow

### Actors

* Administrator

### Workflow

1. The administrator selects a recipe.
2. The production quantity is entered.
3. Ingredient availability is validated.
4. Raw ingredients are consumed.
5. Produced inventory increases.
6. Inventory movements are generated.
7. The production batch is stored.
8. Audit records are created.

---

# 8.11 Inventory Adjustment Workflow

### Actors

* Administrator

### Workflow

1. A physical inventory count is performed.
2. Differences are identified.
3. The administrator records an adjustment.
4. The system updates stock through inventory movements.
5. The adjustment reason is recorded.
6. Audit events are generated.

---

# 8.12 Daily Closing Workflow

### Actors

* Administrator

### Workflow

1. Review pending orders.
2. Verify that all payments have been completed.
3. Review inventory alerts.
4. Register outstanding expenses.
5. Review production records.
6. Consult operational dashboards.
7. Export daily reports if required.

This workflow provides managers with a consistent operational closing process while preserving all historical business data.
