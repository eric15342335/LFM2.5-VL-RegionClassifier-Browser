# Frontend rewrite report

## Release status

The architectural rewrite and rectangle-only crop migration are implemented. On 2026-07-28, installation, structural audit, manifest validation, formatting, linting, type-checking, Vitest, and the Vite production build all passed. Release qualification remains open only for real-browser interaction/accessibility/WebGPU verification and final model-artifact integrity metadata.

## Architecture summary

The application is now a React application built by Vite and rendered with Mantine. An XState parallel machine owns capability probing, model lifecycle, image lifecycle, selection readiness, classification, cancellation, and recovery. `BrowserInferenceClient` is the main-thread lifecycle boundary around a typed Comlink worker API. Valibot validates the model manifest and data crossing worker/domain boundaries.

The custom Transformers.js inference adapter and deterministic image preprocessing remain intact. `react-image-crop` owns only rectangular interaction; normalized-coordinate conversion and source-pixel preprocessing remain application-owned. A high-level Transformers.js pipeline and Pica are not adopted.

## Migration sequence completed

1. Captured source inventory, baseline LOC, package-install status, and absence of a baseline bundle.
2. Added runtime schemas and schema tests before transport/UI changes.
3. Defined the worker API and replaced request envelopes with Comlink RPC.
4. Added client characterization tests for replay, cancellation, failure, and worker termination.
5. Added the XState application machine and behavioral transition tests.
6. Replaced the static/imperative shell with React and Mantine components.
7. Moved canvas interaction into a dedicated image-workspace component while retaining normalized geometry and preprocessing.
8. Deleted the superseded DOM renderer, UI reducer, browser engine, protocol types, static shell, and generic CSS.
9. Repaired browser-only auditing, manifest validation, metrics, architecture documentation, and release instructions.
10. Performed dependency-free structural verification and a final dead-reference/diff review.

## Library-to-function replacements

| Previous handwritten responsibility                                                       | Final implementation                                                                        | Library/API                    | Result                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| Element lookup, event binding, conditional DOM rendering                                  | Declarative component tree                                                                  | React 19                       | Removed the 1,196-line imperative entrypoint               |
| Static layout, controls, drop target, feedback, responsive CSS                            | `AppShell`, `Grid`, `Stack`, `Dropzone`, `Progress`, `Alert`, notifications                 | Mantine                        | Reduced CSS from 1,379 to 92 physical lines                |
| Mutable UI flags and derived workflow reducer                                             | Parallel state machine, invoked actors, guards, tags, abortable services                    | XState 5 and `@xstate/react`   | Centralized valid transitions and invalid-state prevention |
| Worker request IDs, pending map, response envelopes, callback messages, serialized errors | Typed remote methods, proxied callbacks, transferable buffers, remote exception propagation | Comlink                        | Removed custom worker transport plumbing                   |
| Unchecked manifest/worker boundary values                                                 | Runtime schemas and parsing                                                                 | Valibot                        | Added explicit failure at external boundaries              |
| Custom crop pointer, touch, focus, move, and resize interaction                           | Controlled free-form rectangular crop                                                       | react-image-crop               | Removes custom interaction behavior                        |
| Source-pixel crop, mask, resize, prompt, token, and scoring behavior                      | Retained behind typed boundaries                                                            | Existing tested implementation | Preserves inference-sensitive processing                   |

## Files added

- `src/main.tsx`
- `src/app/App.tsx`
- `src/app/ImageWorkspace.tsx`
- `src/app/ResultPanel.tsx`
- `src/app/DiagnosticsPanel.tsx`
- `src/app/app.machine.ts`
- `src/app/format.ts`
- `src/app/__tests__/App.test.tsx`
- `src/app/__tests__/app.machine.test.ts`
- `src/domain/schemas.ts`
- `src/inference/client.ts`
- `src/inference/worker-api.ts`
- `src/__tests__/inference-client.test.ts`
- `src/__tests__/schemas.test.ts`
- `src/styles/workspace.css`
- `scripts/measure-codebase.mjs`
- `scripts/verify-model-manifest.mjs`
- `docs/frontend-rewrite-plan.md`
- `docs/browser-inference.md`
- `docs/workstream-reports.md`
- `docs/frontend-rewrite-report.md`

## Files materially changed

- `src/inference/browser-inference.worker.ts`
- `src/config.ts`
- `src/types.ts`
- `index.html`
- `vite.config.ts`
- `tsconfig.json`
- `eslint.config.mjs`
- `package.json`
- `model-manifest.json`
- `scripts/audit-browser-only.mjs`
- `README.md`

## Files deleted

- `src/main.ts`
- `src/ui-state.ts`
- `src/__tests__/ui-state.test.ts`
- `src/engines/browser-engine.ts`
- `src/styles/app.css`
- `src/styles/ui-overrides.css`
- `src/worker/browser-inference.worker.ts` (moved and converted under `src/inference`)

## Behavioral and parity coverage authored

- Application happy-path transitions and invalid early classification
- Model, image, and classification actor boundaries
- Cancellation through an invoked actor's abort signal
- Asynchronous device-loss invalidation
- Worker RPC recovery, retained-image replay, cancellation, failure, and termination
- Manifest and domain schema validation
- Existing processor controls, prompt/token construction, output parsing/scoring, latest-only scheduling, image format, normalized rectangular crop geometry, no-upscale resizing, and pixel preprocessing tests retained
- Accessibility-critical model-load and file-browse controls, status messaging, and idle cancellation state

## Validation commands and results

| Command                                                     | Result                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `node scripts/audit-browser-only.mjs`                       | Passed: React root, pinned model artifacts, and stale-boundary checks   |
| `node scripts/verify-model-manifest.mjs`                    | Passed: all 12 artifacts include exact byte lengths and SHA-256 values  |
| `node scripts/measure-codebase.mjs`                         | Passed and generated final metrics                                      |
| `git diff --check`                                          | Passed                                                                  |
| TypeScript syntax transpilation over all `.ts`/`.tsx` files | Passed for 29 files using the globally available compiler API           |
| `pnpm run check`                                            | Passed: format, lint, type-check, 31 Vitest tests, and production build |
| Browser pointer/touch/keyboard/accessibility/WebGPU checks  | Blocked: no browser is attached to the available browser runtime        |

## LOC comparison

| Metric                      | Before | After |          Change |
| --------------------------- | -----: | ----: | --------------: |
| Production physical LOC     |  5,117 | 3,348 | -1,769 (-34.6%) |
| Production nonblank LOC     |  4,645 | 3,116 | -1,529 (-32.9%) |
| TypeScript/TSX physical LOC |  3,213 | 3,246 |     +33 (+1.0%) |
| CSS physical LOC            |  1,379 |    88 | -1,291 (-93.6%) |
| HTML physical LOC           |    525 |    14 |   -511 (-97.3%) |

The small TypeScript increase replaces a substantially larger amount of HTML/CSS and imperative orchestration while adding explicit workflow and boundary tests. Test and documentation LOC are excluded from production metrics.

## Bundle and performance comparison

No valid before/after bundle comparison is available. The supplied baseline did not include `dist/`, and package installation failed before either baseline or rewritten Vite builds could be produced. Runtime performance and real WebGPU output parity therefore remain release gates, not inferred results.

## Dependencies added

Runtime:

- React and React DOM
- XState and `@xstate/react`
- Mantine core, hooks, dropzone, and notifications
- Comlink
- Valibot

Development:

- Vite React plugin
- React type packages
- Testing Library and `user-event`
- jsdom

The existing Vite, TypeScript, Vitest, Transformers.js, ESLint, Prettier, Stylelint, HTML validation, and Oxc lint foundations remain.

## Dependencies removed or reclassified

No installed inference dependency was removed. `@ianvs/prettier-plugin-sort-imports` was moved from runtime dependencies to development dependencies. Most reduction comes from deleting handwritten UI, state, transport, and CSS rather than swapping inference libraries.

## Known limitations and blocked gates

1. Browser pointer, touch, keyboard, focus, responsive-alignment, accessibility-tree, optimized-build, image-replacement, worker-restart, and WebGPU checks have not run because no browser is attached to the available browser runtime.
2. No baseline production bundle is available for comparison.

## Deferred opportunities

- **`react-image-crop`:** adopted at `~11.1.2` for the rectangle-only UI. Percentage-to-normalized conversion is tested independently and inference preprocessing remains outside the interaction library.
- **Pica:** deferred because the current no-upscale bilinear output is inference-sensitive. Adoption requires pixel diff thresholds and output-score parity benchmarks.
- **High-level Transformers.js pipeline:** rejected for this migration because it would obscure processor controls, custom prompt/token construction, scoring, cancellation checkpoints, diagnostics, warm-up, and device-loss behavior.
- **End-to-end browser tests:** deferred only because dependencies and a suitable WebGPU browser/runtime were unavailable here; they remain mandatory before release.

## Completion-criteria check

| Criterion                                              | Status                   | Evidence / remaining work                                                |
| ------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------ |
| 1. Build, type-check, lint, tests pass                 | **Passed**               | `pnpm run check` passed on 2026-07-28                                    |
| 2. Behavior covered by parity tests                    | **Partially verified**   | Unit characterization passes; real-browser and WebGPU parity remain open |
| 3. No unjustified temporary migration layer            | **Checked**              | Old UI, reducer, engine, and protocol deleted                            |
| 4. Superseded DOM/CSS/protocol/state/utilities deleted | **Checked**              | Listed deletions and stale-reference audit                               |
| 5. Runtime errors/cancellation propagate               | **Passed in unit tests** | Comlink client, hard-reset fallback, XState abort flow                   |
| 6. Accessibility/keyboard behavior verified            | **Blocked**              | No browser is attached to the available browser runtime                  |
| 7. Bundle/performance not materially regressed         | **Blocked**              | No baseline build and no install                                         |
| 8. Production LOC substantially lower                  | **Checked**              | Physical production LOC reduced 34.6%                                    |
| 9. Final dependency set justified                      | **Checked**              | Replacement table and retained/deferred rationale above                  |
| 10. Final architecture/release docs present            | **Checked**              | README and `docs/` architecture/release documents                        |
| 11. No stale references or unverified metadata         | **Passed**               | Source references audited; all manifest artifact hashes are present      |

The repository must not be released until every blocked or partial criterion above is closed in an environment with package registry access and WebGPU browser coverage.

## Productive-time measurement

Elapsed work time was measured from the epoch timestamp written at the first repository inspection and checked with `date +%s`. The marker showed 31 minutes 29 seconds before it was removed from the production tree; subsequent validation and packaging work occurred after that measurement. Only repository inspection, research, implementation, review, validation attempts, documentation, and packaging were counted; no sleep command or artificial delay was used.
