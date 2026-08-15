# Agent Orchestration

The Task Coordinator is the task-scoped Planner in this model. The name emphasizes that it plans, delegates, reviews evidence, updates state, and closes exactly one task.

## Pipeline

```text
Leader
  → Task Coordinator
    → Requirements Router
    → Architect (when required)
    → Implementer
    → Reviewer
    → repair and fresh review when rejected
    → scoped commit
  → completion receipt to Leader
```

Only one implementation task runs at a time in the shared working tree.

## Model Routing Policy

The human initializes the Leader, so the harness does not prescribe the Leader's model.

The Leader must create every Task Coordinator with:

| Role | Model | Reasoning effort |
| --- | --- | --- |
| Task Coordinator | `gpt-5.6-terra` | `medium` |

The Task Coordinator assigns all remaining agents. Use the lowest tier that satisfies the task, according to the following deterministic classification.

### Complexity Classification

Classify the task before spawning an Architect or Implementer. Record the level and concrete reason in the context packet.

- **High** when any of these apply: authentication or authorization; security; database schema or migration; business invariants; payments; inventory or production transactions; immutable history; transaction/event/realtime boundaries; backup or deployment safety; cross-module consistency; destructive-risk behavior; or unresolved architectural ambiguity.
- **Medium** when High does not apply and any of these apply: a multi-file feature, API or external integration, non-trivial UI state, persistence access using an established pattern, performance work, report/export behavior, or task size `medium`/`large`.
- **Low** only when the change is isolated, explicit, reversible, task size `small`, and does not cross a security, data, transaction, infrastructure, or module boundary.

When uncertain between two levels, choose the higher level. Task priority is not a substitute for complexity, and task size alone cannot lower a risk-triggered High classification.

### Specialist Assignment

| Complexity | Architect, when required | Implementer |
| --- | --- | --- |
| Low | `gpt-5.6-terra`, `medium` | `gpt-5.6-terra`, `medium` |
| Medium | `gpt-5.6-terra`, `high` | `gpt-5.6-terra`, `high` |
| High | `gpt-5.6-sol`, `high` | `gpt-5.6-sol`, `high` |

Use `gpt-5.6-terra` with `medium` reasoning for a separately spawned Requirements Router because its work is bounded extraction and summarization.

Every Reviewer uses:

| Role | Model | Reasoning effort |
| --- | --- | --- |
| Reviewer | `gpt-5.6-sol` | `high` |

Reviewer quality must not be reduced based on task size. The Reviewer is the independent quality gate, while its compact context packet controls token usage. A repair cycle uses the original Implementer tier and a fresh `gpt-5.6-sol` High Reviewer.

If a prescribed model is unavailable, stop and report the unavailable assignment to the Leader. Do not silently downgrade, substitute an unlisted model, or weaken reasoning effort. The Leader or human may explicitly authorize an equal-or-stronger available substitute, which must be recorded in the context packet and completion receipt.

## 1. Leader

The Leader reads compact state, identifies a dependency-ready task, and creates a fresh `gpt-5.6-terra` Medium Coordinator. It does not supervise file-level work or load the full PRD.

Before dispatch, the Leader confirms:

- The task is not Done or human-owned.
- Every dependency is Done.
- No other implementation task is active.
- The task belongs to the current milestone unless a recorded reason permits otherwise.

The Leader receives only the completion receipt or a blocker report.

## 2. Coordinator Initialization

The Coordinator:

1. Records task ID, base commit, branch, and pre-existing dirty paths.
2. Changes task status to `in_progress` in the working tree.
3. Creates an ignored runtime directory for the task.
4. Invokes the Requirements Router.
5. Uses the task's explicit `architecture_required` value to route the next step.
6. Classifies task complexity and records every model/reasoning assignment before spawning specialists.

The Coordinator coordinates but does not make product or architecture decisions on behalf of specialists.

## 3. Requirements Routing

The Router resolves the task's PRD references to exact headings and copies only the relevant excerpts into the context packet. It adds applicable invariants, state transitions, authorization rules, non-functional constraints, decisions, and UI references.

The Router must report unresolved or contradictory references instead of guessing.

## 4. Architecture

When required, a read-only Architect returns a short plan using the architecture-plan template. The Coordinator rejects plans that omit affected boundaries, data/transaction implications, or verification.

When not required, the Coordinator writes a minimal implementation handoff directly from the task packet. This is routing, not architecture invention.

## 5. Implementation

The Implementer changes only in-scope files, runs the specified checks, and returns:

- Changed paths.
- Behavior implemented.
- Tests added or changed.
- Commands run and results.
- Remaining risks or blockers.

The Implementer does not commit and does not mark the task Done.

## 6. Review

A fresh read-only Reviewer compares the implementation to the task, exact PRD excerpts, accepted plan, and base diff. It independently runs relevant checks where feasible and writes a structured report.

- `Approved`: no blocking findings; Definition of Done is satisfied.
- `Changes Requested`: one or more blocking findings with evidence.

Advisory observations must be separated from blocking findings.

## 7. Repair Loop

The Coordinator sends blocking findings to an Implementer. A fresh Reviewer evaluates the revised complete diff. Two rejected review cycles trigger escalation to the Leader. Do not weaken acceptance criteria to end the loop.

## 8. Commit and Completion

After approval, the Coordinator:

1. Confirms no unrelated path will be staged.
2. Re-runs the required final checks.
3. Updates task status to `done`.
4. Checks the task in `tasks/backlog.md`.
5. Updates `harness/project-state.md`.
6. Creates a final receipt in `harness/history/`.
7. Runs the harness validator.
8. Reviews the staged diff and scans for secrets.
9. Creates one Conventional Commit.
10. Sends the Leader the task ID, commit, checks, verdict, and next dependency-ready suggestion.

## Human Checkpoints

For `owner: human` or `requires_human: true`:

- Do not invoke Architect, Implementer, or Reviewer.
- State exactly what evidence or external action is required.
- Keep status `waiting_for_human` until the human confirms completion.
- Record supplied evidence without copying secrets.
- Continue unrelated work only when its dependencies are satisfied.

## Blockers

Use `blocked` only for a concrete unresolved condition. A blocker report contains:

- What is blocked.
- Evidence and attempted safe alternatives.
- Who can unblock it.
- Whether unrelated tasks remain available.
