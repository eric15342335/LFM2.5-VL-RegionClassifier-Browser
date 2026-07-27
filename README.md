# LFM2.5-VL selected-region classifier

A static, browser-only selected-region image classifier. Image decoding, cropping, masking, model execution, and result generation run locally through Transformers.js, ONNX Runtime Web, and WebGPU. There is no application backend, inference API, upload session, or remote inference route.

## Requirements

- A current secure-context browser with WebGPU and `shader-f16`
- Enough browser storage for the selected model profile and runtime cache
- Node.js 22 or newer and Corepack for development

## Application architecture

- **React + React Compiler:** component shell and render optimization
- **Mantine:** layout, controls, drop zone, progress, feedback, responsive behavior, and accessible primitives
- **XState:** capability, model, image, classification, cancellation, and recovery workflows
- **Comlink:** typed Web Worker RPC, callback proxies, transferables, and remote errors
- **Valibot:** runtime validation at manifest and worker boundaries
- **Transformers.js WebGPU adapter:** preserved custom processor, generation, scoring, diagnostics, cancellation, warm-up, and device-loss behavior

The main thread retains the original `File` and decoded `ImageBitmap`. The worker receives image bytes once, then subsequent classifications send only an image identifier and normalized selection coordinates. An unexpected inference failure permits one worker rebuild and retained-image replay.

See `docs/browser-inference.md` for the runtime contract and `docs/frontend-rewrite-plan.md` for the migration rationale.

## Model profile

`model-manifest.json` pins `onnx-community/LFM2.5-VL-450M-ONNX` to commit `3e0c8bb3b2268ffa7b30dba6a3c2d1985d87fb14` with FP16 embeddings, an FP16 vision encoder, and a Q4F16 merged decoder. The selected large data shards total approximately 573 MB; configuration, tokenizer, processor, and graph files add a small amount beyond that estimate.

The repository-published SHA-256 values for the three large data shards are recorded. Exact lengths and SHA-256 values for every remaining artifact are still required before changing `integrity_status` to `verified`.

## Development

```bash
corepack enable
corepack pnpm install
corepack pnpm run dev
```

Production validation:

```bash
corepack pnpm run check
```

Dependency-free checks can run before installation:

```bash
node scripts/audit-browser-only.mjs
node scripts/verify-model-manifest.mjs
node scripts/measure-codebase.mjs
```

The production build is a static `dist/` directory. `vite.config.ts` emits relative asset URLs for root or subpath deployment.

## Release requirements

A release must pass formatting, lint, type-checking, all Vitest suites, the Vite production build, browser accessibility checks, bundle comparison, and model-manifest verification. Do not mark the model manifest verified until every listed artifact has an exact byte length and SHA-256 value.
