# Frontend rewrite report

## Release status

The architectural rewrite is implemented. Release qualification is **blocked** in this execution environment because npm registry DNS resolution fails (`EAI_AGAIN registry.npmjs.org`). Consequently, the dependency graph and lockfile could not be regenerated, and the full lint, type-check, Vitest, Vite build, browser accessibility, bundle, and WebGPU hardware gates could not be executed. This report distinguishes implemented work from verified release gates.

## Architecture summary

The application is now a React application compiled through the React Compiler Babel plugin and rendered with Mantine. An XState parallel machine owns capability probing, model lifecycle, image lifecycle, selection readiness, classification, cancellation, and recovery. `BrowserInferenceClient` is the main-thread lifecycle boundary around a typed Comlink worker API. Valibot validates the model manifest and data crossing worker/domain boundaries.

The custom Transformers.js inference adapter and deterministic image preprocessing remain intact. The rewrite does not adopt a high-level Transformers.js pipeline, `react-image-crop`, or Pica because processing, coordinate, and pixel equivalence have not been established for those substitutions.

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

| Previous handwritten responsibility | Final implementation | Library/API | Result |
| --- | --- | --- | --- |
| Element lookup, event binding, conditional DOM rendering | Declarative component tree | React 19 | Removed the 1,196-line imperative entrypoint |
| Static layout, controls, drop target, feedback, responsive CSS | `AppShell`, `Grid`, `Stack`, `Dropzone`, `Progress`, `Alert`, notifications | Mantine | Reduced CSS from 1,379 to 92 physical lines |
| Mutable UI flags and derived workflow reducer | Parallel state machine, invoked actors, guards, tags, abortable services | XState 5 and `@xstate/react` | Centralized valid transitions and invalid-state prevention |
| Worker request IDs, pending map, response envelopes, callback messages, serialized errors | Typed remote methods, proxied callbacks, transferable buffers, remote exception propagation | Comlink | Removed custom worker transport plumbing |
| Unchecked manifest/worker boundary values | Runtime schemas and parsing | Valibot | Added explicit failure at external boundaries |
| Ad hoc render optimization pressure | Build-time component compilation | React Compiler | Avoids hand-authored memoization by default |
| Custom crop, mask, resize, prompt, token, and scoring behavior | Retained behind typed boundaries | Existing tested implementation | Avoided an unproven parity regression |

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
- Existing processor controls, prompt/token construction, output parsing/scoring, latest-only scheduling, image format, normalized crop geometry, ellipse/rectangle masking, no-upscale resizing, and pixel preprocessing tests retained
- Accessibility-critical model-load and file-browse controls, status messaging, and idle cancellation state

## Validation commands and results

| Command | Result |
| --- | --- |
| `node scripts/audit-browser-only.mjs` | Passed: React root, pinned model artifacts, and stale-boundary checks |
| `node scripts/verify-model-manifest.mjs` | Passed structurally: 3 of 12 artifacts currently contain SHA-256 values |
| `node scripts/measure-codebase.mjs` | Passed and generated final metrics |
| `git diff --check` | Passed |
| TypeScript syntax transpilation over all `.ts`/`.tsx` files | Passed for 29 files using the globally available compiler API |
| `corepack pnpm install --frozen-lockfile=false` | Blocked by DNS: `EAI_AGAIN registry.npmjs.org` |
| `pnpm run format:check` | Not executable without installed packages |
| `pnpm run lint` | Not executable without installed packages |
| `pnpm run typecheck` | Not executable with project typings unavailable |
| `pnpm run test` | Not executable without installed packages |
| `pnpm run build` | Not executable without installed packages |
| Browser accessibility/WebGPU regression pass | Not executable in this environment |

## LOC comparison

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Production physical LOC | 5,117 | 3,348 | -1,769 (-34.6%) |
| Production nonblank LOC | 4,645 | 3,116 | -1,529 (-32.9%) |
| TypeScript/TSX physical LOC | 3,213 | 3,246 | +33 (+1.0%) |
| CSS physical LOC | 1,379 | 88 | -1,291 (-93.6%) |
| HTML physical LOC | 525 | 14 | -511 (-97.3%) |

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

- React Compiler and Vite React plugin
- React type packages
- Testing Library and `user-event`
- jsdom

The existing Vite, TypeScript, Vitest, Transformers.js, ESLint, Prettier, Stylelint, HTML validation, and Oxc lint foundations remain.

## Dependencies removed or reclassified

No installed inference dependency was removed. `@ianvs/prettier-plugin-sort-imports` was moved from runtime dependencies to development dependencies. Most reduction comes from deleting handwritten UI, state, transport, and CSS rather than swapping inference libraries.

## Known limitations and blocked gates

1. `pnpm-lock.yaml` was not regenerated and does not yet represent the rewritten `package.json`.
2. Full formatting, lint, type-check, Vitest, and production-build verification has not run.
3. Bundle size, startup timing, memory use, and real WebGPU performance have not been measured.
4. Real-browser keyboard, screen-reader, canvas, and responsive visual checks have not run.
5. The three large model shards have upstream SHA-256 values, but nine smaller artifacts still lack exact byte and digest metadata; manifest integrity remains pending.
6. `react-image-crop` and Pica remain deferred until coordinate and pixel-output equivalence benchmarks are available.

## Deferred opportunities

- **`react-image-crop`:** deferred because the current interaction uses normalized rectangle/ellipse semantics and keyboard percentage editing. Replacement requires golden coordinate conversion tests and browser interaction parity.
- **Pica:** deferred because the current no-upscale bilinear output is inference-sensitive. Adoption requires pixel diff thresholds and output-score parity benchmarks.
- **High-level Transformers.js pipeline:** rejected for this migration because it would obscure processor controls, custom prompt/token construction, scoring, cancellation checkpoints, diagnostics, warm-up, and device-loss behavior.
- **End-to-end browser tests:** deferred only because dependencies and a suitable WebGPU browser/runtime were unavailable here; they remain mandatory before release.

## Completion-criteria check

| Criterion | Status | Evidence / remaining work |
| --- | --- | --- |
| 1. Build, type-check, lint, tests pass | **Blocked** | Registry DNS prevented installation and execution |
| 2. Behavior covered by parity tests | **Partially verified** | Suites authored/retained; execution blocked |
| 3. No unjustified temporary migration layer | **Checked** | Old UI, reducer, engine, and protocol deleted |
| 4. Superseded DOM/CSS/protocol/state/utilities deleted | **Checked** | Listed deletions and stale-reference audit |
| 5. Runtime errors/cancellation propagate | **Implemented; execution blocked** | Comlink client, hard-reset fallback, XState abort flow, tests authored |
| 6. Accessibility/keyboard behavior verified | **Partially verified** | Accessible implementation/tests authored; browser audit blocked |
| 7. Bundle/performance not materially regressed | **Blocked** | No baseline build and no install |
| 8. Production LOC substantially lower | **Checked** | Physical production LOC reduced 34.6% |
| 9. Final dependency set justified | **Checked** | Replacement table and retained/deferred rationale above |
| 10. Final architecture/release docs present | **Checked** | README and `docs/` architecture/release documents |
| 11. No stale references or unverified metadata | **Partial** | Source references audited; 9 manifest hashes and lockfile remain unresolved |

The repository must not be released until every blocked or partial criterion above is closed in an environment with package registry access and WebGPU browser coverage.

## Productive-time measurement

Elapsed work time was measured from the epoch timestamp written at the first repository inspection and checked with `date +%s`. The marker showed 31 minutes 29 seconds before it was removed from the production tree; subsequent validation and packaging work occurred after that measurement. Only repository inspection, research, implementation, review, validation attempts, documentation, and packaging were counted; no sleep command or artificial delay was used.
