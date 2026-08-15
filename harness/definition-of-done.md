# Shared Definition of Done

An AI-owned task is Done only when every applicable item is true:

- [ ] The expected outcome is implemented.
- [ ] The task's Not Included boundary was respected.
- [ ] Relevant PRD requirements, business rules, invariants, and state transitions are satisfied.
- [ ] Tests were added or updated where behavior changed.
- [ ] Relevant tests pass.
- [ ] Type checking, linting, and formatting checks pass without a new regression.
- [ ] Server-side authorization, validation, data integrity, and secret handling were considered where applicable.
- [ ] UI work follows the style guide, relevant mockup intent, responsive requirements, and accessibility rules.
- [ ] Documentation was updated when behavior, interfaces, configuration, operations, or architectural decisions changed.
- [ ] The complete diff contains no unrelated or unexplained changes.
- [ ] A read-only independent Reviewer returned `Approved`.
- [ ] Task metadata, backlog, project state, and final evidence agree.

“Not applicable” must be justified in the review report; it is not an implicit pass.

For a human-owned checkpoint, Done means the requested decision or external action is explicitly confirmed and its non-secret evidence is recorded. Code and AI review are not required unless the task says otherwise.

