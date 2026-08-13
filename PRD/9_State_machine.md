# 9. State Machines

This chapter formally defines the lifecycle of the principal business entities managed by the Restaurant Management System.

State machines define every valid transition within the domain and establish the business constraints that govern those transitions.

No entity shall transition to a state that is not explicitly defined in this chapter.

---

# 9.1 Order State Machine

The Order State Machine models the operational lifecycle of an order from creation until payment.

```text
Draft
    │
    ▼
Pending
    │
    ▼
Ready
    │
    ▼
On the Way
    │
    ▼
Delivered
    │
    ▼
Paid
```

The **Draft** state exists only in the client application while the waiter is composing the order. Draft orders are not persisted and are invisible to other users.

Once confirmed, the order becomes **Pending** and is immediately persisted.

---

## State Definitions

### Draft

The waiter is creating or editing the order.

Visible only to the current user.

Allowed actions:

* Add products
* Remove products
* Modify products
* Cancel draft
* Confirm order

---

### Pending

The order has been confirmed and is waiting for preparation.

Visible to:

* Waiters
* Kitchen
* Managers

Allowed actions:

* Edit order
* Cancel order (authorized users)
* Kitchen starts preparation

---

### Ready

Kitchen preparation has finished.

The order is waiting to be collected.

Allowed actions:

* Mark On the Way
* Cancel (Manager only)

---

### On the Way

The waiter has collected the order.

Allowed actions:

* Mark Delivered

---

### Delivered

Every product has reached the customer.

Allowed actions:

* Register payments
* Complete payment

---

### Paid

Every customer basket has been completely paid.

This is the terminal operational state.

---

## Valid State Transitions

| From       | To         | Performed By           |
| ---------- | ---------- | ---------------------- |
| Draft      | Pending    | Waiter                 |
| Pending    | Ready      | Kitchen                |
| Ready      | On the Way | Waiter                 |
| On the Way | Delivered  | Waiter                 |
| Delivered  | Paid       | Waiter / Administrator |

---

## Exceptional Transitions

| From    | To        | Condition          |
| ------- | --------- | ------------------ |
| Pending | Cancelled | Manager permission |
| Ready   | Cancelled | Manager permission |

Cancelled orders never return to an operational state.

---

# 9.2 Payment State Machine

Payments are independent of order preparation.

```text
Pending
     │
     ▼
Partially Paid
     │
     ▼
Paid
```

Optional future extension:

```text
Paid
 │
 ▼
Refunded
```

---

## State Definitions

### Pending

No payment has been received.

---

### Partially Paid

One or more payments have been registered.

Outstanding balance still exists.

---

### Paid

Outstanding balance equals zero.

No additional payments are accepted.

---

### Refunded (Future)

Administrative refund after payment completion.

---

# 9.3 Customer Basket State Machine

Each customer basket maintains its own payment lifecycle.

```text
Pending

↓

Paid
```

This allows one customer to finish payment while another has not yet paid.

The Order becomes Paid only after every basket reaches Paid.

---

# 9.4 Production State Machine

```text
Planned

↓

In Progress

↓

Completed
```

Future versions may introduce:

* Cancelled
* Archived

---

## State Definitions

### Planned

Production batch has been created.

Ingredients have not yet been consumed.

---

### In Progress

Production has started.

Inventory validation has succeeded.

---

### Completed

Ingredients consumed.

Produced inventory added.

Inventory movements generated.

---

# 9.5 Inventory Movement State Machine

Inventory movements are immutable.

They do not change state after creation.

Instead of modifying an inventory movement, corrective operations generate additional movements.

```text
Created

↓

Persisted
```

Terminal state.

---

# 9.6 Audit Event Lifecycle

Audit events are immutable.

```text
Generated

↓

Persisted
```

Terminal state.

Audit events cannot be edited or deleted.

---

# 9.7 State Transition Validation Rules

The system shall reject any transition that:

* Skips required intermediate states.
* Is performed by an unauthorized role.
* Violates business invariants.
* Produces inconsistent inventory.
* Produces inconsistent payment balances.

Transition validation shall occur within the business domain before persistence.

---

# 9.8 Time Metrics

The system shall automatically record timestamps for every state transition.

Example:

* Created At
* Ready At
* On the Way At
* Delivered At
* Paid At

These timestamps provide the basis for operational KPIs and reporting.

---

# 9.9 Future State Extensions

The architecture shall allow introducing additional operational states without redesigning the domain model.

Examples include:

* Preparing
* Waiting for Customer
* Delivered Partially
* Refunded
* Archived

State transitions shall remain configuration-driven whenever possible.
