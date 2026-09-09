# T-066 Blocker Report

## Blocked work

T-066 — Build the daily sales dashboard.

## Blocker

No authoritative restaurant reporting timezone or business-day rollover is defined. The task requires validated date/timezone handling for financial daily totals. The PRD, approved initial operating configuration, Prisma schema, and accepted ADRs do not supply this value. `America/Guayaquil` appears only in the audit page's display formatting, which is not an approved business configuration and cannot be silently repurposed as a reporting boundary.

## Evidence and safe alternatives attempted

- Requirements routing resolved FR-REP-001, BI-026, authorization requirements, timestamp requirements, and NFR-004.
- Targeted inspection found persisted timestamps but no reporting-timezone setting.
- A fixed timezone would change the financial definition of a daily report, so deriving it from a UI display precedent would violate the configuration/source-of-truth rules.

## Required human decision

Confirm the restaurant reporting timezone and whether its business day is midnight-to-midnight (or specify a different daily rollover).

## Unrelated ready work

T-067 remains dependency-ready and can proceed while this decision is pending.
