# Completion Receipt — T-004

- Task: Provision the Supabase development project and credentials.
- Completion type: Human checkpoint.
- Commit: Pending at receipt creation; the checkpoint commit is created after this tracked receipt and cannot self-reference.
- Evidence: The restaurant owner confirmed project provisioning and client configuration on 2026-08-15.
- Development project: `carnales`, ref `qsujkexjecpkcqawryqi`, São Paulo (`sa-east-1`), healthy at creation.
- Client configuration: Project URL and publishable key were retrieved through the connected Supabase MCP and populated without recording server-only credential material in Git.
- Server-only access: No privileged server operation currently requires a secret key. A previously exposed key was revoked by the owner; its replacement is not stored in the repository.
- Migration policy: ADR-001 requires all remote Supabase migrations to be applied and verified through MCP.
- PRD references verified: PRD 11.5 Availability; PRD 12.4, 12.15–12.16.
- Secrets: None recorded.
- Code or AI review: Not applicable; this is a human-owned checkpoint.
- Next suggested dependency-ready task: T-005 — Implement typed environment configuration and startup validation.
