# Validation report

Validated during the browser-only cleanup on 2026-07-27.

## Completed without dependency installation

- removed the Python/FastAPI backend, server engine, hybrid router, backend tests, environment template, legacy server UI, and Python lock/configuration files
- moved browser assets under `src/` and configured Vite for a self-contained static `dist/` build with relative URLs
- replaced backend-provided runtime configuration with bundled browser configuration
- changed timing and runtime result fields to browser-native WebGPU metrics
- updated documentation to describe only browser inference
- ran `node scripts/audit-browser-only.mjs` to verify forbidden server files and inference-route references are absent, DOM IDs match the TypeScript UI contract, and the model manifest remains pinned
- ran TypeScript syntax and local-module checks using the globally available compiler plus temporary external-module declarations
- ran direct Node assertions for pure preprocessing and image-container helpers
- ran archive and text audits for obsolete backend/server artifacts

## Not executed

Per task constraints, dependencies were not installed or fetched. The Vite production build, Vitest, ESLint, Stylelint, Prettier, and HTML validation therefore require an environment where the declared packages are already available.

Run after dependencies are available:

```bash
pnpm install
pnpm run check
```

## Hardware/model qualification still required

This environment does not expose a browser WebGPU device and did not download the model. Real model warm-up, inference, browser-cache behavior, and WebGPU device-loss recovery remain hardware qualification tasks rather than claimed results.
