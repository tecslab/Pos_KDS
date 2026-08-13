# 7. Domain Model

The Domain Model defines the core business entities that compose the Restaurant Management System and describes how they relate to one another.

The purpose of this model is to establish a common business vocabulary shared by developers, designers, product owners, and future AI development assistants.

The model intentionally avoids implementation details such as database schemas or API contracts.

---

# 7.1 Restaurant

## Description

Represents the business entity operating the system.

Although the initial release supports a single restaurant, the model is designed to allow future multi-branch support.

## Responsibilities

* Store business information.
* Configure taxes.
* Configure printers.
* Configure payment methods.
* Configure operational parameters.

---

# 7.2 Service Location

## Description

Represents a physical location where customer orders originate.

Examples include:

* Dining tables
* Dispatch window
* Counter
* Future delivery pickup areas

## Attributes

* Name
* Type
* Display order
* Active status
* Allow multiple active orders

## Relationships

A Service Location may contain many Orders over time.

A Service Location may have one or multiple active Orders depending on its configuration.

---

# 7.3 Order

## Description

Represents a customer's request for one or more products.

The Order is the central business entity of the application.

## Responsibilities

* Maintain operational state.
* Group customer baskets.
* Calculate totals.
* Track preparation.
* Track delivery.
* Track payment completion.

## Attributes

* Order Number
* Status
* Creation Date
* Service Location
* Assigned Waiter
* Total Amount
* Notes

## Relationships

An Order:

* belongs to one Service Location
* contains one or more Customer Baskets
* contains one or more Order Lines
* has many Payments
* generates Inventory Movements
* generates Audit Events

---

# 7.4 Customer Basket

## Description

Represents a logical group of products belonging to one customer.

Customer Baskets allow split billing while maintaining a single operational order.

## Responsibilities

* Group products.
* Calculate subtotal.
* Track payment status.

## Relationships

A Customer Basket:

* belongs to one Order
* contains many Order Lines
* receives many Payments

---

# 7.5 Order Line

## Description

Represents one sellable product within an order.

Products with identical configurations are grouped into a single order line.

## Responsibilities

* Store quantity.
* Store selected options.
* Store ingredient removals.
* Calculate line total.

## Attributes

* Quantity
* Unit Price
* Product Name
* Observations

## Relationships

Each Order Line references one Product Version.

---

# 7.6 Product

## Description

Represents a sellable menu item.

Products are managed through the Product Catalog.

## Responsibilities

* Define pricing.
* Define available options.
* Define removable ingredients.
* Define printer aliases.
* Define recipe.

## Relationships

A Product:

* belongs to one Category
* references one Recipe (optional)
* may reference one Inventory Item (for resale products)

---

# 7.7 Product Category

## Description

Groups products into logical menu sections.

Examples:

* Tacos
* Burritos
* Drinks

Categories simplify navigation within the Point of Sale.

---

# 7.8 Recipe

## Description

Defines how a produced product is manufactured.

Recipes determine ingredient consumption during production.

## Responsibilities

* Define ingredients.
* Define required quantities.
* Support version history.

---

# 7.9 Inventory Item

## Description

Represents a stock-controlled item.

Inventory Items may represent:

* Raw ingredients
* Produced products
* Resale products

## Responsibilities

* Maintain stock.
* Record movements.
* Define measurement units.

---

# 7.10 Inventory Movement

## Description

Represents an immutable stock transaction.

Inventory quantities are calculated from these movements.

## Responsibilities

Record:

* Purchases
* Sales
* Production
* Waste
* Adjustments
* Rollbacks

---

# 7.11 Production Batch

## Description

Represents one production operation.

Example:

Preparing 15 liters of salsa.

## Responsibilities

* Consume ingredients.
* Increase produced inventory.
* Record recipe version.

---

# 7.12 Payment

## Description

Represents a financial transaction.

Payments are independent of operational order states.

## Responsibilities

* Register amount.
* Register payment method.
* Update basket balance.

---

# 7.13 Expense

## Description

Represents an operating expense unrelated to customer sales.

Examples:

* Supplier purchases
* Utilities
* Maintenance
* Miscellaneous expenses

---

# 7.14 User

## Description

Represents an authenticated employee.

Authentication is delegated to Supabase.

The application is responsible for authorization.

---

# 7.15 Role

## Description

Represents a collection of permissions.

Examples:

* Administrator
* Waiter
* Kitchen Personnel

---

# 7.16 Permission

## Description

Represents an individual authorization capability.

Examples:

* Create Order
* Cancel Order
* Register Payment
* Register Production
* Manage Inventory

Roles aggregate permissions.

---

# 7.17 Audit Event

## Description

Represents an immutable record of a significant business event.

Every important business action generates one Audit Event.

---

# 7.18 Domain Relationships

The following diagram summarizes the primary relationships between the core entities.

```text
Restaurant
│
├── Service Locations
│      │
│      └── Orders
│             │
│             ├── Customer Baskets
│             │        │
│             │        ├── Order Lines
│             │        └── Payments
│             │
│             ├── Audit Events
│             └── Inventory Movements
│
├── Product Categories
│      │
│      └── Products
│              │
│              ├── Recipes
│              └── Inventory Items
│
├── Production Batches
│
├── Users
│      │
│      └── Roles
│               │
│               └── Permissions
│
└── Expenses
```

The Order acts as the central aggregate of the operational domain, coordinating customer baskets, order lines, payments, and operational state transitions.
