# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Build: `npm run build` runs `tsc && vite build`.
- Tests: `npm test` runs the Playwright headless observer suite and Jev triage conformance (`scripts/test_runner.mjs`). Requires Playwright browser (`npx playwright install chromium`).
- Fast unit tests: `npm run test:unit` runs mocked unit tests with `node --test tests/jev_triage.test.mjs`.
- Headless physics failure triage: `src/jev/` implements TypeSafe Jev System One decision client (`typesafe/jev-1.13`) with confidence gating and deterministic heuristic fallback when `TYPESAFE_API_KEY` / `JEV_API_KEY` is not set. High-confidence float variance drift is auto-marked flaky pass; low-confidence and genuine regressions are flagged for human inspection or failed. Mocked in tests to ensure zero external network calls.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
