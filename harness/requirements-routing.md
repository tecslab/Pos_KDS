# Requirements Routing

The Requirements Router is a stateless context-construction role. It does not approve designs or implementations.

## Input

- Active task file.
- Task PRD references.
- Accepted decision records.
- Resource index.
- Target diff or affected modules when known.

## Routing Procedure

1. Resolve each task reference to a PRD file and exact heading.
2. Include the complete referenced requirement subsection, not an isolated sentence.
3. Add only cross-cutting material that applies:
   - Business invariants from Chapter 6.
   - Entity relationships from Chapter 7.
   - Workflow steps from Chapter 8.
   - State transitions and timestamps from Chapter 9.
   - Permissions from Chapter 10.
   - Relevant non-functional requirements from Chapter 11.
   - Architecture constraints from Chapter 12.
4. For UI tasks, add `styleguide.md`, the one relevant mockup, and the logo path.
5. List exclusions and unresolved conflicts explicitly.

## PRD Chapter Map

| Reference prefix | Source file |
| --- | --- |
| Chapter 1 | `PRD/1_Vision_&_Product_overview.md` |
| Chapter 2 | `PRD/2_Business_Context.md` |
| Chapter 3 | `PRD/3_Goals_&_Success_metrics.md` |
| Chapter 4 | `PRD/4_User_roles_&_Personas.md` |
| Chapter 5 and `FR-*` | `PRD/5_Functional_requirements.md` |
| Chapter 6 and `BI-*` | `PRD/6_General_business_rules.md` |
| Chapter 7 | `PRD/7_Domain_model.md` |
| Chapter 8 | `PRD/8_User_Workflows.md` |
| Chapter 9 | `PRD/9_State_machine.md` |
| Chapter 10 | `PRD/10_Authorization_model.md` |
| Chapter 11 and `NFR-*` | `PRD/11_Non_functional_requirements.md` |
| Chapter 12 | `PRD/12_Technical_architecture_&_Design_decisions.md` |

Resolve ranges to every included subsection. A bare `BI-*`, `FR-*`, or `NFR-*` reference uses the mapped canonical chapter even when the task's shorthand omits the chapter number.

## Output Packet

The packet must contain:

- Task identity, expected outcome, exclusions, dependencies, and Definition of Done.
- Exact PRD source paths, headings, and excerpts.
- Applicable invariants, authorization checks, states, and performance constraints.
- Accepted architectural decisions.
- Relevant resource paths.
- Required verification targets.
- A statement of omitted context.

## Context Limits

- Never include the whole PRD by default.
- Never include all mockups for a single screen.
- Do not include previous task transcripts.
- Prefer source paths and exact headings over paraphrase.
- If a reference cannot be resolved confidently, block routing and report it.
