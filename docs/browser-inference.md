# Browser inference architecture

## Runtime topology

The application has two execution domains:

1. The React main thread owns presentation, normalized selection coordinates, the XState workflow actor, the original image descriptor, a bounded preview `ImageBitmap`, and diagnostics. `BrowserInferenceClient` privately retains the original `File` for worker recovery.
2. A dedicated module worker owns image byte decoding for inference, deterministic crop/mask/resize preprocessing, Transformers.js model loading, WebGPU execution, generation parsing, scoring, cancellation checkpoints, and device-loss observation.

`BrowserInferenceClient` is the only main-thread module that creates or terminates the worker. Comlink supplies typed RPC, callback proxies, exception propagation, and transferable `ArrayBuffer` handling. The client deliberately retains a thin lifecycle layer for hard termination, timeouts, one recovery attempt, and replaying retained images after worker recreation.

## Workflow model

`src/app/app.machine.ts` is a parallel XState machine with independent model, image, and classification regions after capability probing. It prevents classification unless the model, image, and normalized selection are ready. Invoked promise actors receive abort signals; exiting the classification state therefore cancels the worker operation. A callback actor receives asynchronous worker/device-loss events and invalidates model readiness even when no RPC is pending.

## Worker API

`src/inference/worker-api.ts` defines the boundary:

- `probe(config)`
- `prepare(config, warmup, onProgress)`
- `loadImage(descriptor, bytes, config)`
- `releaseImage(imageId)`
- `classify(request, onProgress)`
- `cancel(jobId)`
- `setDeviceLostListener(listener)`
- `dispose()`

Valibot validates the model manifest at startup, image descriptors and regions at the worker boundary, and capability/classification responses when they return to the main thread.

## Parity-sensitive processing

The rewrite preserves the custom inference adapter and preprocessing implementation. `react-image-crop` owns only free-form rectangular pointer, touch, resize, move, and keyboard interaction. The application keeps normalized coordinates as the authoritative state and derives percentage crops for the UI; no rendered-pixel coordinates are persisted. A selection is retained when the user clicks outside it, may touch every image edge, and must span at least 1% on both axes before it can be classified. There is no automatic region after image load; the full image is not classified when no region exists. Users can clear a region by applying zero-width or zero-height coordinates; accidental outside clicks never clear it.

Characterization tests cover normalized rectangle conversion, rectangular masking, no-upscale bilinear resizing, JPEG preparation, processor controls, prompt/token construction, output parsing, score extraction, cancellation, latest-only scheduling, device loss, and retained-image recovery. The interaction library is not used for source-pixel extraction, masking, resizing, tensor construction, or inference.

## Failure and recovery rules

- Model loading and classification have independent timeouts.
- Classification cancellation first requests cooperative cancellation; a hard worker reset is the fallback.
- Unexpected inference failure triggers exactly one worker rebuild and retained-image replay before retrying.
- Device loss terminates the current worker and notifies the workflow machine immediately.
- A second failure propagates to the UI with technical details and does not loop indefinitely.

## Release verification

`node scripts/audit-browser-only.mjs` rejects stale imperative UI/worker protocol paths, server routes, unpinned model URLs, and inconsistent verified manifest metadata.

`node scripts/verify-model-manifest.mjs` verifies the local manifest structure. Every pinned artifact records an exact byte length and SHA-256 value, and the manifest has `integrity_status: "verified"`.
