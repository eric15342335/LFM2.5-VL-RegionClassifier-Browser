# Frontend rewrite implementation plan

## Constraints and verified decisions

- Preserve the custom Transformers.js generation path, processor parity controls, prompt construction, token slicing, score calculation, cancellation semantics, device-loss recovery, and retained-image replay.
- Preserve selection normalization, bankers rounding, padding, masking, no-upscale resize, JPEG quality, and diagnostic payloads.
- Adopt React, XState, Mantine, Comlink, and Valibot.
- `react-image-crop` is adopted for rectangular interaction only; normalized-coordinate and source-pixel preprocessing remain application-owned.
- Defer Pica until benchmark and model-output parity are demonstrated.
- Keep Vite, TypeScript, Vitest, and the Transformers.js patch.

## Sequential workstreams

### 0. Baseline and characterization

Files: existing tests, `rewrite-baseline.json`, new behavior tests.

Acceptance criteria:

- Structural audit passes.
- Baseline production, TypeScript, HTML, and CSS LOC are recorded.
- Characterization covers worker scheduling/cancellation, manifest validation, workflow transitions, prompt/token controls, crop geometry, and recovery policy.

### 1. Runtime contracts and domain boundaries

Files: `src/domain/schemas.ts`, `src/inference/worker-api.ts`, `src/types.ts`, `src/config.ts`.

Acceptance criteria:

- Manifest and worker-boundary data are parsed with Valibot.
- Domain types are inferred or explicitly shared without protocol-envelope unions.
- Invalid manifests and malformed boundary values fail with actionable errors.

### 2. Comlink transport

Files: `src/inference/client.ts`, `src/inference/browser-inference.worker.ts`, tests.

Acceptance criteria:

- `wrap`, `expose`, `proxy`, `transfer`, and `releaseProxy` replace request IDs, pending maps, response switches, and error serialization.
- Progress, cancellation, latest-only scheduling, worker termination, device loss, and retained-image replay remain observable and tested.
- No extra image-byte clone is introduced.

### 3. XState workflow

Files: `src/app/app.machine.ts`, selectors, tests.

Acceptance criteria:

- Capability, model, image, selection, and classification lifecycle are represented as explicit states/events.
- Invalid/partial states cannot trigger classification.
- Cancellation and one-retry recovery are explicit transitions.
- Primary action/status/progress are derived from machine state only.

### 4. React/Mantine shell

Files: `src/main.tsx`, `src/app/App.tsx`, component files, minimal workspace CSS, `index.html`.

Acceptance criteria:

- Existing user-visible controls, status, results, diagnostics, event log, copy actions, keyboard cancellation, and coordinate editing are preserved.
- Mantine owns generic layout, controls, progress, feedback, responsive behavior, and accessibility.
- Bespoke CSS is limited to canvas/selection presentation and a small number of product-specific details.

### 5. Deletion and hardening

Files: obsolete DOM/CSS/protocol/state files, README, release scripts, package/tooling configuration.

Acceptance criteria:

- No temporary renderer, protocol compatibility path, stale ID binding, dead selector, missing documentation link, or pending integrity claim remains unexplained.
- Final dependencies are justified; tooling overlap is reduced only when equivalent checks remain.
- Build, type-check, lint, tests, structural audit, bundle report, LOC report, and dead-code scan are recorded.

## Integration order

Each workstream is integrated only after its tests pass. Files are owned by one workstream at a time; no concurrent edits are permitted. Diffs are inspected for net complexity and rejected when they add wrappers without removing owned behavior.
