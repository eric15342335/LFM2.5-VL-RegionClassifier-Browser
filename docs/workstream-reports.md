# Rewrite workstream reports

## Architecture

**Scope:** module boundaries, dependency plan, migration order.  
**Files changed:** `docs/frontend-rewrite-plan.md`, final architecture documentation.  
**Removed:** direct coupling between UI rendering, worker messages, and inference lifecycle.  
**Libraries introduced:** React, React Compiler, XState, Mantine, Comlink, Valibot.  
**Tests:** architecture enforced through structural audit and boundary tests.  
**Commands:** source inventory, baseline LOC script, browser-only audit.  
**Risk:** dependency installation could not be executed in this environment because npm registry DNS resolution failed.

## Parity

**Scope:** preserve preprocessing, processor controls, prompt/token construction, generation parsing/scoring, cancellation, device loss, and replay.  
**Files changed:** existing characterization tests plus `src/app/__tests__/app.machine.test.ts` and `src/__tests__/inference-client.test.ts`.  
**Removed:** no parity-sensitive implementation.  
**Libraries introduced:** Vitest remains the test runner; XState actors are tested behaviorally.  
**Risk:** real-browser WebGPU and pixel tests require installed dependencies and compatible hardware.

## UI

**Scope:** React/Mantine shell, image workspace, responsive result and diagnostic views, keyboard coordinate input, live status, cancellation.  
**Files changed:** `src/app/App.tsx`, `ImageWorkspace.tsx`, `ResultPanel.tsx`, `DiagnosticsPanel.tsx`, `src/main.tsx`, `index.html`, `src/styles/workspace.css`.  
**Removed:** `src/main.ts`, 523-line static shell, generic legacy CSS.  
**Libraries introduced:** React, Mantine core/dropzone/notifications.  
**Tests:** `src/app/__tests__/App.test.tsx`.  
**Risk:** browser visual and keyboard verification remains blocked until dependencies install.

## State

**Scope:** capability, model load, image load, selection, classification, cancellation, and recovery workflows.  
**Files changed:** `src/app/app.machine.ts`.  
**Removed:** `src/ui-state.ts` and UI-owned mutable orchestration flags.  
**Libraries introduced:** XState and `@xstate/react`.  
**Tests:** happy path, invalid prerequisites, cancellation, asynchronous device loss.  
**Risk:** final TypeScript verification awaits dependency installation.

## Worker

**Scope:** typed RPC, transferables, lifecycle, latest-only scheduling, errors, cleanup.  
**Files changed:** `src/inference/browser-inference.worker.ts`, `worker-api.ts`, `client.ts`.  
**Removed:** request/response envelopes, request correlation map, manual error serialization, direct `postMessage` protocol, old browser engine.  
**Libraries introduced:** Comlink.  
**Tests:** success/recovery/replay, cancellation, worker failure and termination.  
**Risk:** Comlink integration build could not be run without packages.

## Image

**Scope:** selection interaction and preprocessing boundary.  
**Files changed:** canvas interaction moved to `ImageWorkspace.tsx`; preprocessing files intentionally retained.  
**Removed:** imperative canvas DOM plumbing.  
**Libraries introduced:** none for crop/resize because equivalence is not proven.  
**Tests:** existing selection geometry, image format, and pixel preprocessing tests retained.  
**Risk:** canvas rendering needs a real-browser regression pass.

## Tooling and review

**Scope:** package proposal, React Compiler plugin, runtime schemas, audits, metrics, manifest checks, documentation.  
**Files changed:** `package.json`, `vite.config.ts`, `tsconfig.json`, scripts, README/docs, model manifest.  
**Removed:** stale architecture references and obsolete source paths.  
**Libraries introduced:** Valibot and React Compiler.  
**Commands:** structural audit, manifest verification, metrics, `git diff --check`; install/type-check attempts recorded as blocked.  
**Risk:** lockfile regeneration, full checks, build/bundle comparison, browser accessibility audit, and release metadata completion remain open due the unavailable npm registry and incomplete upstream artifact digests.
