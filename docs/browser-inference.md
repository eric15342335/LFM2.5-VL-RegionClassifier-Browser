# Browser inference architecture

## Execution boundary

```text
Browser UI
  └─ BrowserInferenceEngine
      └─ dedicated module worker
          ├─ Transformers.js 4.2.0
          ├─ ONNX Runtime Web / WebGPU
          ├─ resident decoded-image map
          └─ crop → processor → greedy generation
```

All image handling and inference execute in the browser. The application has no inference API, upload endpoint, server session, or remote fallback route.

The browser may download model and runtime artifacts from their configured hosts. That network activity is asset retrieval, not server-side inference; source images are not included in those requests.

## Worker protocol

The engine and worker exchange these messages:

- `PROBE`
- `PREPARE`
- `LOAD_IMAGE`
- `RELEASE_IMAGE`
- `CLASSIFY`
- `CANCEL`
- `GET_STATUS`
- `DISPOSE`

The worker allows one active generation and retains only the newest pending classification. A newer pending request supersedes the previous pending request. Cancellation uses `InterruptableStoppingCriteria`; worker termination is the hard cleanup path. WebGPU device loss invalidates model state and is reported to the main thread.

The engine performs one worker rebuild, model reload, image restore, and retry after a non-cancellation classification failure.

## Generation profile

```ts
{
  do_sample: false,
  num_beams: 1,
  max_new_tokens: 8,
  use_cache: true,
  return_dict_in_generate: logprobsEnabled,
  output_scores: logprobsEnabled,
}
```

The application prompt and generation limits are bundled in `src/config.ts`. Prepared text is rejected when it exceeds the 256-token application guard.

## Processor profile

The worker attempts to apply these controls to supported processor configuration surfaces:

```text
do_image_splitting = false
min_image_tokens = 32
max_image_tokens = 64
min_tiles = 1
max_tiles = 1
resample = bilinear-compatible enum 2
```

Results include processor diagnostics such as prepared image dimensions, tensor shapes, tile count, text sequence length, image-placeholder count, attention-mask length, and warnings for controls the runtime did not expose.

## Preprocessing profile

- decode in the browser with EXIF-orientation handling when supported
- validate JPEG, PNG, or WebP containers
- reject GIF, APNG, and animated WebP input
- enforce encoded-byte and decoded-pixel limits
- floor/ceil crop geometry with 8% max-dimension padding
- rectangle or ellipse isolation mask
- whole-crop mean-RGB background fill
- no upscaling
- maximum model image side of 384 pixels
- bilinear canvas resize
- JPEG quality 88

## Privacy boundary

The source file is retained by the main thread and decoded in the inference worker. Classification messages contain an image identifier and normalized selection coordinates. There is no application code that uploads source images, generated crops, prompts, or results to an inference service.

## Qualification boundary

Before release on a supported hardware matrix:

1. Verify exact model artifact lengths and SHA-256 values.
2. Run the complete formatter, linter, typecheck, unit-test, and production-build suite.
3. Compare preprocessing fixtures across JPEG, PNG, WebP, alpha, color-profile, and EXIF cases.
4. Collect cold-download, cached-load, compile, warm-up, p50/p90/p95 inference, memory, and soak metrics.
5. Exercise cancellation, supersession, device loss, low storage, cache eviction, offline, and model-host failure paths.
6. Confirm network traces contain model/runtime retrieval only and never source-image payloads.
7. Complete license and NOTICE review.
