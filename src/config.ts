import manifestJson from "../model-manifest.json";

import type { InferenceConfig, ModelManifest } from "./types";

const model = manifestJson as ModelManifest;

export const INFERENCE_CONFIG: Readonly<InferenceConfig> = Object.freeze({
  prompt:
    "Name the single main visible subject in this image. " +
    "The subject may be a person, animal, body part, or object. " +
    "Reply with only the most specific common English noun phrase, lowercase, one to four words. " +
    "If a whole human is the main subject, reply person. " +
    "No article, punctuation, explanation, brand, scene, material, or unsupported adjective. " +
    "If unclear, reply unknown.",
  maxOutputTokens: 8,
  contextTokens: 256,
  imageTokens: 64,
  cropPadding: 0.08,
  imageSide: 384,
  jpegQuality: 88,
  maxImageBytes: 100 * 1024 * 1024,
  maxImagePixels: 40_000_000,
  inferenceTimeoutSeconds: 300,
  modelLoadTimeoutSeconds: 600,
  resampling: "bilinear",
  logprobs: true,
  model,
});
