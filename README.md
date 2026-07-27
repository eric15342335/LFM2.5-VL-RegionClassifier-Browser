# LFM2.5-VL selected-region classifier

A static, browser-only selected-region image classifier. Image decoding, cropping, masking, model execution, and result generation all run in the browser through Transformers.js, ONNX Runtime Web, and WebGPU.

There is no application backend, inference API, upload session, or remote inference route in this repository. The model artifacts are downloaded directly by the browser from the immutable repository revision declared in `model-manifest.json` and may be cached by the browser.

## Requirements

- A current browser with WebGPU and `shader-f16` support
- HTTPS or localhost
- Enough browser storage for the model download and runtime cache
- Node.js 24.8 or newer for local development and production builds

## Model profile

The browser profile is defined by `model-manifest.json`:

- repository: `onnx-community/LFM2.5-VL-450M-ONNX`
- revision: `3e0c8bb3b2268ffa7b30dba6a3c2d1985d87fb14`
- Transformers.js: `4.2.0`
- execution provider: WebGPU
- token embeddings: FP16
- vision encoder: FP16
- merged decoder: Q4F16
- verified compressed initial transfer: approximately 573 MB

Artifact sizes are currently estimates and integrity verification remains pending. Release automation should populate exact byte lengths and SHA-256 values before changing `integrity_status` to `verified`.

## Development

```bash
corepack enable
pnpm install
pnpm run dev
```

The production build is a static site:

```bash
pnpm run build
```

Deploy the generated `dist/` directory on an HTTPS origin. `vite.config.ts` uses relative asset URLs, so the build can be hosted at an origin root or under a subpath.

## Browser architecture

- `src/config.ts`: application-owned inference configuration and pinned model manifest.
- `src/engines/browser-engine.ts`: worker lifecycle, request correlation, cancellation, retained images, timeouts, and one recovery attempt.
- `src/worker/browser-inference.worker.ts`: WebGPU capability probe, model loading, warm-up, preprocessing, greedy generation, score extraction, and device-loss reporting.
- `src/preprocess.ts`: crop geometry, rectangle/ellipse masking, mean-RGB fill, no-upscale resize, and JPEG preparation.
- `src/image-format.ts`: JPEG/PNG/WebP signature validation and animated-image rejection.
- `src/main.ts`: browser UI and diagnostics.

The original image is copied once into the dedicated application worker. Subsequent classifications send only the image identifier and normalized selection coordinates. No image bytes are sent to an application server.

See `docs/browser-inference.md` for the worker protocol and runtime profile.

## Checks

The repository includes a dependency-free structural audit:

```bash
node scripts/audit-browser-only.mjs
```

After dependencies are available, run the full suite:

```bash
pnpm run check
```

## Deployment notes

- Browser caches are evictable. “Model ready” means the pinned revision loaded, compiled, and warmed up in the current browser lifecycle.
- Do not enable ONNX Runtime's proxy worker with WebGPU; ONNX Runtime already runs inside the application-owned module worker.
- Serve JavaScript, WebAssembly, and model assets with correct MIME types. Use immutable caching for revisioned model artifacts.
- Source images, crops, prompts, labels, and generated tokens should remain excluded from telemetry.
- A Content Security Policy must permit the selected model host and any Transformers.js runtime assets used by the build.
