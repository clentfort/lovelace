# lovelace

Codename for the personal workflow tooling project inspired by Sitra/Lovelace from the Wayfarer series.

We start with a Pi memory extension.

## Docs

- `docs/memory-extension-v1.md` — v1 product/technical spec for the memory extension
- `docs/memory-extension-implementation-checklist.md` — implementation status and next steps

## Current code

- `extensions/memory/src/` — Pi memory extension implementation
- `tests/` — store, parsing, continuation, scan, and view tests
- `/ll:task recent` — show recently linked tasks for the current project
- `/ll:memory stats [global]` — show memory counts by status/scope/source
- `/ll:memory maintain` — archive stale candidate/inactive memories

Optional backend selection:

- `LOVELACE_MEMORY_BACKEND=sqlite` (default)
- `LOVELACE_MEMORY_BACKEND=qmd` (uses `@tobilu/qmd` TS API for memory indexing/search, local-only files)

## Development

This repo follows the non-browser parts of the tooling stack from Christoph Nakazawa's “Fastest Frontend Tooling for Humans & AI” post:

- `pnpm`
- `Vitest`
- `Oxlint`
- `Oxfmt`
- `npm-run-all2`

Common commands:

- `pnpm test` — run the Vitest suite once
- `pnpm test:watch` — run Vitest in watch mode
- `pnpm test:coverage` — run Vitest with coverage
- `pnpm lint` — run Oxlint
- `pnpm format` — format with Oxfmt
- `pnpm format:check` — check formatting with Oxfmt
- `pnpm check` — run lint, format check, and tests in parallel
