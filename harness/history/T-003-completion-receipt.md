# Completion Receipt — T-003

- Task: Confirm initial restaurant operating configuration.
- Completion type: Human checkpoint.
- Commit: Pending at receipt creation; the checkpoint commit is created after this tracked receipt and cannot self-reference.
- Evidence: The restaurant owner explicitly confirmed `restaurantData.md` as the source for this checkpoint on 2026-08-15.
- Approved non-secret configuration: Carnales — Mexican Grill; configurable 15% tax-inclusive menu pricing; Tables 1–15 and Dispatch Window (the only location allowing multiple active orders); Cash, DeUna, and JEP Fast payment methods; 11:00–22:00 business hours; kitchen warning/critical thresholds of 5/7 minutes; delivery warning/critical thresholds of 6/8 minutes; no negative stock.
- Policy resolution: DeUna and JEP Fast are the configured labels for the two initial bank-transfer payment methods. Cash remains an initial method required by PRD 5.4.
- PRD references verified: PRD 5.4 Payment System; PRD 5.8 Administration; PRD 6.8 Pricing; PRD 6.18 Business Configuration.
- Secrets: None supplied or recorded.
- Code or AI review: Not applicable; this is a human-owned checkpoint.
- Next suggested dependency-ready task: T-021 — Define the printer service port and safe no-op adapter.
