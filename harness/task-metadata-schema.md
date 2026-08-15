# Task Metadata Contract

Every `tasks/T-*.md` file starts with YAML front matter using this strict schema.

| Field | Allowed value |
| --- | --- |
| `id` | Unique `T-NNN` identifier |
| `title` | Non-empty string |
| `status` | `todo`, `waiting_for_human`, `in_progress`, `blocked`, `done` |
| `priority` | `critical`, `high`, `medium`, `low` |
| `size` | `small`, `medium`, `large` |
| `type` | Stable lowercase snake-case category |
| `dependencies` | YAML list of task IDs |
| `owner` | `ai` or `human` |
| `reviewer` | `ai_reviewer` or `null` |
| `requires_human` | Boolean |
| `architecture_required` | Boolean |
| `prd_references` | YAML list of reference strings |
| `definition_of_done` | `harness/definition-of-done.md` |

Human ownership requires `requires_human: true`, `reviewer: null`, `architecture_required: false`, and initially `status: waiting_for_human`.

Task bodies contain Expected Outcome, Not Included, and a link to the shared Definition of Done.

