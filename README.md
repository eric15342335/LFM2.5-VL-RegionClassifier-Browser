# LFM2.5-VL Region Classifier

Classify objects or areas within an image by drawing a crop around them.

Everything runs locally in the browser: image decoding, cropping, model inference, and result generation. Your images and selected regions are not uploaded to an inference server.

## How it works

1. Open an image.
2. Draw a box around the area you want to classify.
3. Run the model.
4. Review the result and repeat with another region if needed.

The application uses the ONNX version of [LFM2.5-VL-450M](https://huggingface.co/LiquidAI/LFM2.5-VL-450M) published by [ONNX Community](https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX).

## Requirements

You will need:

- A browser with WebGPU support (`shader-f16` is optional)
- Enough browser storage for the model files and runtime cache
- Node.js 22 or newer
- Corepack

Corepack is included with Node.js 22–24. On newer Node.js releases, you may need to install it separately.

Browsers with `shader-f16` use the configured mixed-precision WebGPU profile. Other WebGPU adapters use an all-Q8 CPU/WASM profile, which downloads about 630.7 MB of Q8 ONNX artifacts plus configuration and tokenizer files. Performance depends on the selected backend, browser, GPU/CPU, available memory, and selected region.

## Run locally

Install the dependencies:

```bash
corepack enable
corepack pnpm install
```

Start the development server:

```bash
corepack pnpm run dev
```

Open the address printed by Vite.

The first model load can take longer because the browser needs to download and cache the model files.

## Checks

Run the complete project check before submitting a change:

```bash
corepack pnpm run check
```

You can also run the repository checks separately:

```bash
node scripts/verify-model-manifest.mjs
node scripts/measure-codebase.mjs
```

The individual checks validate the pinned model files and measure the codebase.

See [`package.json`](./package.json) for the complete list of commands and dependencies.

## Production build

Create a production build:

```bash
corepack pnpm run build
```

Preview it locally:

```bash
corepack pnpm run start
```

The generated static site is written to [`dist/`](./dist/).

Vite is configured to use relative asset paths, so the build can be hosted at either a domain root or a nested path.

## Model configuration

Model configuration is pinned in [`model-manifest.json`](./model-manifest.json), including:

- the Hugging Face revision;
- ONNX artifacts;
- runtime options;
- integrity information.

Update the manifest whenever the model revision or runtime configuration changes.

## Architecture

The inference path uses:

- [Transformers.js](https://huggingface.co/docs/transformers.js/index) for model loading and preprocessing
- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html) for browser inference
- WebGPU when `shader-f16` is available, otherwise ONNX Runtime Web WASM with Q8 artifacts

The interface is built with React and Mantine. XState manages application state, Comlink handles worker communication, Valibot validates data, and `react-image-crop` provides region selection.

For a detailed description of the inference flow, see [`docs/browser-inference.md`](./docs/browser-inference.md).

## Project documentation

- [Browser inference architecture](./docs/browser-inference.md)
- [Scripts and dependencies](./package.json)
- [Model manifest](./model-manifest.json)
