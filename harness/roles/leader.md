# Leader Role

## Purpose

Maintain long-running direction without accumulating implementation detail.

## Reads

- `AGENTS.md`
- `harness/project-state.md`
- `tasks/backlog.md`
- The selected task's dependency statuses
- Recent completion or blocker receipts only

## Responsibilities

- Select one dependency-ready task.
- Start a fresh Task Coordinator with the task ID.
- Keep only one implementation pipeline active.
- Accept completion receipts and choose the next task.
- Handle scope conflicts, repeated review failures, and genuine blockers.

## Prohibited

- Loading the entire PRD by default.
- Implementing code while acting as Leader.
- Bypassing review or human checkpoints.
- Committing task files on behalf of an active Coordinator.

