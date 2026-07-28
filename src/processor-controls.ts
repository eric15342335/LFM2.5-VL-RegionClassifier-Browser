import type { InferenceConfig } from "./types";

export type Lfm2VlProcessorControls = Readonly<{
  do_image_splitting: boolean;
  min_image_tokens: number;
  max_image_tokens: number;
  min_tiles: number;
  max_tiles: number;
  resample: number;
}>;

export function lfm2VlProcessorControls(config: InferenceConfig): Lfm2VlProcessorControls {
  return {
    do_image_splitting: false,
    min_image_tokens: Math.min(32, config.imageTokens),
    max_image_tokens: config.imageTokens,
    min_tiles: 1,
    max_tiles: 1,
    resample: 2,
  };
}

export function expectedLfm2VlMaxNumPatches(
  maxImageTokens: number,
  downsampleFactor: number,
  doImageSplitting: boolean,
  tileSize: number,
  encoderPatchSize: number
): number {
  const thumbnailPatches = maxImageTokens * downsampleFactor ** 2;
  const tilePatches = doImageSplitting ? (tileSize / encoderPatchSize) ** 2 : 0;

  return Math.max(thumbnailPatches, tilePatches);
}

export function lfm2VlVisualTokenCount(
  height: number,
  width: number,
  encoderPatchSize: number,
  downsampleFactor: number
): number {
  const tokensPerAxis = (size: number) =>
    Math.ceil(Math.floor(size / encoderPatchSize) / downsampleFactor);

  return tokensPerAxis(height) * tokensPerAxis(width);
}

export function multimodalBudgetMessage(
  inputLength: number,
  contextTokens: number,
  imagePlaceholderCount?: number
): string {
  const placeholders =
    imagePlaceholderCount === undefined
      ? "unknown image placeholders"
      : `${imagePlaceholderCount} image placeholders`;

  return `Prepared multimodal input ${inputLength} > application budget ${contextTokens} (${placeholders})`;
}
