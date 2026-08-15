# Carnales AI Development Harness

This file is the entry point for every agent working in this repository. Follow it before reading broad project context or changing files.

## Mission

Build the restaurant management system defined by the PRD through small, reviewable, specification-grounded tasks while protecting agent context windows and the user's work.

## Sources of Truth

When sources disagree, use this precedence:

1. The PRD and explicitly approved human business configuration.
2. The active task's expected outcome, exclusions, and metadata.
3. Accepted architecture decision records.
4. `styleguide.md`.
5. The HTML mockups as visual references only.

Mockup values and sample data never override business rules or configured values. Stop and escalate unresolved contradictions; do not silently choose one.

## Required Startup Sequence

1. Read this file.
2. Read `harness/project-state.md` and `tasks/backlog.md`.
3. Select only a dependency-ready task according to `harness/orchestration.md`.
4. Read the selected task file. Do not load the entire PRD.
5. Create a task-scoped context packet using `harness/requirements-routing.md`.
6. Record the base commit and all pre-existing working-tree changes before implementation.

## Operating Model

- The Leader is persistent and retains only compact project state.
- Each development iteration uses a fresh Task Coordinator, which is the task-scoped Planner role.
- Only one task may be implemented at a time in the shared working tree.
- Every AI-owned task requires an independent Reviewer.
- Use an Architect only when `architecture_required: true`.
- Architect and Reviewer agents are read-only and must not edit production or harness files.
- Human-owned tasks are checkpoints. Do not architect or implement them.
- If independent review is unavailable, the task cannot be marked Done.
- Do not keep permanent agents with the complete PRD in context. Use exact task-scoped excerpts.

Role contracts live in `harness/roles/`. The complete workflow lives in `harness/orchestration.md`.

## Task Lifecycle

Persistent task statuses are:

- `todo`: not started.
- `waiting_for_human`: requires human input or an external action.
- `in_progress`: a Coordinator owns the task.
- `blocked`: progress cannot continue and the blocker is recorded.
- `done`: independently approved and committed.

Temporary phases—planning, implementing, reviewing, repairing, and committing—belong in ignored runtime state, not task metadata.

Allowed transitions:

```text
todo → in_progress → done
                  ↘ blocked
waiting_for_human → done
                  ↘ blocked
blocked → todo | waiting_for_human
```

An AI task may reach `done` only after the shared Definition of Done is satisfied. A human checkpoint may reach `done` only when the required evidence is supplied and recorded.

## Task Selection

The Leader selects the next task using this order:

1. All dependencies are `done`.
2. The task belongs to the current milestone.
3. Higher priority comes first: critical, high, medium, low.
4. Earlier position in `tasks/backlog.md` breaks ties.

Skip `waiting_for_human` tasks while unrelated dependency-ready work exists. Never bypass an incomplete dependency.

## Context Discipline

- Leader: this file, project state, backlog, and compact completion receipts only.
- Coordinator: one task, dependency statuses, relevant resource indexes, and Git baseline.
- Requirements Router: task PRD references and the minimum exact PRD sections needed.
- Architect: context packet, affected architecture boundaries, and targeted existing code.
- Implementer: approved plan, task criteria, relevant code, and required verification commands.
- Reviewer: task, exact PRD excerpts, plan, base commit, diff, and test evidence.

Prefer targeted `rg` searches. Do not load whole directories, the whole PRD, all mockups, or unrelated task history without a concrete reason.

## Implementation Rules

- Respect task exclusions. Discovering adjacent work does not authorize implementing it.
- Keep business rules in the domain/application layers, not UI or route handlers.
- Preserve immutable business history and server-side authorization.
- Add or update tests in proportion to the change.
- For UI work, read `styleguide.md`, the relevant mockup only, and use `carnalesComp.png` as the logo source.
- Never hardcode values that the PRD declares configurable.
- Never expose, print, commit, or copy secrets into harness artifacts.
- Preserve unrelated user changes in a dirty worktree.

## Review and Repair

The Reviewer returns exactly one verdict: `Approved` or `Changes Requested`.

The review must:

- Tie blocking findings to the task, PRD, invariant, architecture decision, or Definition of Done.
- Inspect the complete task diff from its recorded base.
- Verify tests rather than trusting the Implementer's summary.
- Identify out-of-scope and unrelated changes.
- Remain read-only.

After `Changes Requested`, the Coordinator sends the findings to an Implementer and then requests a fresh review. After two rejected review cycles, escalate to the Leader and record the blocker.

## Git and Commit Protocol

- Only the Task Coordinator creates task commits.
- Never commit before Reviewer approval.
- Stage exact attributable paths; never use broad staging in a dirty worktree.
- Re-check the staged diff and secret exposure before committing.
- Update the task status, backlog checkbox, project state, and final review receipt in the same commit as the implementation.
- Use Conventional Commits, for example `feat(auth): integrate Supabase login`.
- One task normally produces one commit. If the task cannot fit coherently, return it for decomposition instead of silently creating a large implementation.
- Do not amend, rewrite, reset, or discard user history unless explicitly authorized.

## State and Records

- Task front matter is canonical.
- `tasks/backlog.md` is the ordered checklist and must agree with task status.
- `harness/project-state.md` is a compact operational summary, not an alternate task database.
- Store final evidence in `harness/history/`.
- Store lasting architectural choices in `harness/decisions/`.
- Store raw prompts, temporary plans, and handoffs only in ignored `harness/runtime/`.

Run `node harness/scripts/validate-harness.mjs` before completing any harness-state update.

## Definition of Done

Every task inherits `harness/definition-of-done.md`. Reviewer approval is mandatory but does not replace objective verification.
