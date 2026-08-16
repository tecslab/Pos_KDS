# Carnales Restaurant System

Carnales is a TypeScript Next.js modular monolith. This repository currently
contains the application skeleton and architecture boundaries only; product
features, authentication, and persistence are intentionally not part of this
foundation.

## Development

```bash
npm ci
npm run dev
```

Use `npm run build` for a production build and `npm start` to serve it. The
production build uses Next.js's supported webpack compiler for compatibility
with restricted build environments.

## Quality checks

Run the complete local quality gate with:

```bash
npm run check
```

The individual commands are available when iterating on a specific concern:

- `npm run lint` checks the TypeScript and Next.js code with ESLint.
- `npm run format` validates formatting with Prettier; `npm run format:write`
  applies it.
- `npm run typecheck` performs TypeScript checking without emitting files.
- `npm run test` executes unit tests with Vitest. Domain contracts and
  framework-facing helpers have focused suites alongside their source files;
  future business rules should follow the same pattern.

Continuous integration runs the quality gate and production build for pushes
to `main` and pull requests.

## Architecture

All application code lives under `src/`:

- `app/` is the Next.js presentation and composition boundary. Pages and route
  handlers translate transport concerns and wire dependencies; they do not own
  business rules.
- `components/` contains presentation components shared by multiple screens.
- `modules/` contains the business capabilities: `orders`, `kitchen`,
  `delivery`, `payments`, `inventory`, `production`, `reports`, and
  `administration`.
- `domain/` contains framework-independent domain concepts shared across
  capabilities.
- `shared/` contains stable, non-domain-specific contracts and utilities shared
  across capabilities.
- `infrastructure/` contains replaceable adapters for external systems.
- `lib/` contains framework-facing helpers and composition utilities.

The dependency direction is inward:

```text
presentation / composition -> application contracts and use cases -> domain
                                      ^
                                      |
                  infrastructure implements inward-facing ports
```

Concrete infrastructure is wired only at composition boundaries. Capability
modules own their future application and domain behavior. Cross-module access
must use an intentional public entry point (for example, a module `index.ts`);
deep imports into another module are not allowed. These rules keep business
logic testable and independent of Next.js and external integrations.

### Error and result convention

Expected business failures are returned as `Result<T, BusinessError>` values;
they are not thrown. The shared business-error union covers invalid state
transitions, insufficient inventory, invalid payment amounts, and unauthorized
operations. Technical failures continue to throw and are handled at transport
catch boundaries. Route handlers can use `mapErrorToHttp` to translate either
kind of failure into a framework-neutral descriptor with a fixed, safe public
message, then construct the framework response at the route boundary.
