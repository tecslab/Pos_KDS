# 11. Non-Functional Requirements

This chapter defines the quality attributes that the Restaurant Management System must satisfy independently of its functional behavior.

---

# 11.1 Performance

## NFR-001

The Point of Sale shall respond to user interactions in less than **200 ms** under normal operating conditions.

---

## NFR-002

Order confirmation shall complete in less than **2 seconds**, including persistence, synchronization and printing.

---

## NFR-003

Real-time synchronization shall propagate state changes to connected clients within **1 second**.

---

## NFR-004

Reports for a single business day shall load within **3 seconds**.

---

# 11.2 Scalability

The system shall support future expansion without major architectural changes.

The initial architecture should support:

* Multiple tablets
* Multiple kitchen displays
* Hundreds of orders per day

Future releases should support:

* Multiple restaurant branches
* Centralized reporting
* Delivery integrations

---

# 11.3 Availability

The application shall maximize operational availability during business hours.

Unexpected application failures shall not result in confirmed order loss.

Every confirmed order shall already exist in persistent storage before downstream processing begins.

---

# 11.4 Reliability

Business operations shall be transactional whenever consistency requires it.

Examples include:

* Order confirmation
* Production registration
* Inventory rollback
* Payment registration

The system shall avoid partial business operations.

---

# 11.5 Security

Authentication shall be delegated to Supabase Authentication.

Authorization shall be enforced by the application.

Sensitive operations shall always be validated on the server.

Passwords shall never be managed directly by the application.

---

# 11.6 Auditability

Every critical business event shall generate immutable audit records.

Audit information shall remain available throughout the lifetime of the system.

---

# 11.7 Data Integrity

The system shall preserve business consistency through domain validation.

Examples include:

* Valid state transitions.
* Positive inventory balances (unless configured otherwise).
* Referential integrity.
* Immutable historical records.

---

# 11.8 Usability

The application is optimized for tablet usage.

Interfaces shall prioritize:

* Large touch targets.
* Minimal navigation.
* Low interaction count.
* High visual clarity.

Operational screens should remain usable during peak restaurant hours.

---

# 11.9 Maintainability

Business logic shall be separated from presentation logic.

The architecture shall encourage:

* Modular components.
* Clear domain boundaries.
* Automated testing.
* Configuration-driven behavior.

---

# 11.10 Observability

The application shall produce logs suitable for diagnosing operational issues.

Logs should include:

* Errors
* Warnings
* Authentication failures
* Unexpected exceptions
* Performance metrics

Business events shall not rely solely on application logs and shall instead be recorded through the audit subsystem.

---

# 11.11 Compatibility

The application shall support modern Chromium-based browsers.

Primary target devices include:

* Android tablets
* iPads
* Desktop browsers

Responsive layouts shall adapt to different screen sizes without loss of functionality.

---

# 11.12 Localization

The initial release shall support Spanish.

The architecture shall allow future multilingual support without modifying business logic.

---

# 11.13 Accessibility

The user interface should follow recognized accessibility guidelines where practical, including:

* Sufficient color contrast.
* Keyboard navigation for desktop users.
* Screen reader compatibility for administrative interfaces.
* Clear status indicators independent of color alone.

---

# 11.14 Backup and Recovery

The database shall be backed up according to the operational policies of the deployment environment.

Recovery procedures shall preserve:

* Orders
* Payments
* Inventory
* Production
* Audit history

---

# 11.15 Extensibility

The architecture shall support future capabilities including:

* QR ordering
* Customer loyalty
* Delivery platforms
* Kitchen analytics
* Multi-branch management
* Additional payment providers
* AI-assisted forecasting
* Business intelligence integrations

These features should require minimal impact on the existing domain model.

---

# 11.16 Technical Quality Goals

The implementation should prioritize:

* High cohesion.
* Low coupling.
* Domain-driven design principles.
* Configuration over hardcoding.
* Immutable business history.
* Testable business logic.
* Clear separation of concerns.
* API-first architecture.
* Real-time synchronization as a core capability.

These quality goals shall guide architectural decisions throughout the project's lifecycle.
