# LFM2.5-VL Selected-Region Classifier

A browser-only image classifier for selected regions. The app decodes images, crops regions, runs inference, and creates results locally in the browser. It does not use an application backend, inference API, upload session, or remote inference route.

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Scripts](#scripts)
- [Model](#model)
- [Deployment](#deployment)
- [Documentation](#documentation)

## Requirements

- A secure-context browser that supports [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) and `shader-f16`
- Browser storage for the model and runtime cache
- [Node.js](https://nodejs.org/) 22 or later and [Corepack](https://nodejs.org/api/corepack.html)
a

## Quick start

Install the dependencies and start the development server:

```bash
corepack enable
corepack pnpm install
corepack pnpm run dev
```

Open the local address printed by [Vite](https://vite.dev/).

## Scripts

Run the full quality check before submitting changes:

```bash
corepack pnpm run check
```

Build and preview the production site:

```bash
corepack pnpm run build
corepack pnpm run start
```

Run individual dependency-free checks when needed:

```bash
node scripts/audit-browser-only.mjs
node scripts/verify-model-manifest.mjs
node scripts/measure-codebase.mjs
```

See [package.json](./package.json) for every script, dependency, development tool, and package-manager version.

## Model

The app runs the ONNX conversion of [LFM2.5-VL-450M](https://huggingface.co/LiquidAI/LFM2.5-VL-450M) from [ONNX Community](https://huggingface.co/onnx-community/LFM2.5-VL-450M-ONNX). It uses [Transformers.js](https://huggingface.co/docs/transformers.js/index), [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript/web.html), and WebGPU for local inference.

The pinned model revision, runtime settings, artifacts, and integrity metadata are in [model-manifest.json](./model-manifest.json).

## Deployment

`pnpm run build` creates the static site in [`dist/`](./dist/). The [Vite configuration](./vite.config.ts) uses relative asset URLs, so the site can be deployed at a domain root or subpath.

## Documentation

- [Browser inference architecture](./docs/browser-inference.md)
- [Package scripts and dependencies](./package.json)
- [Model manifest](./model-manifest.json)

The interface is built with [React](https://react.dev/), [Mantine](https://mantine.dev/), [XState](https://stately.ai/docs/xstate), [Comlink](https://github.com/GoogleChromeLabs/comlink), [Valibot](https://valibot.dev/), and [react-image-crop](https://github.com/DominicTobias/react-image-crop).

[Back to top](#lfm25-vl-selected-region-classifier)
