import { describe, expect, it } from "vitest";
import { INFERENCE_CONFIG } from "../config";
import {
  expectedLfm2VlMaxNumPatches,
  lfm2VlProcessorControls,
  lfm2VlVisualTokenCount,
  multimodalBudgetMessage,
} from "../processor-controls";

describe("LFM2-VL processor controls", () => {
  it("applies snake_case processor controls and calculates padding", () => {
    const controls = lfm2VlProcessorControls(INFERENCE_CONFIG);

    expect(controls).toEqual({
      do_image_splitting: false,
      min_image_tokens: 32,
      max_image_tokens: 64,
      min_tiles: 1,
      max_tiles: 1,
      resample: 2,
    });
    expect(
      expectedLfm2VlMaxNumPatches(
        controls.max_image_tokens,
        2,
        controls.do_image_splitting,
        512,
        16
      )
    ).toBe(256);
  });

  it("limits the warm-up image geometry to 64 visual placeholders", () => {
    const controls = lfm2VlProcessorControls(INFERENCE_CONFIG);
    const visualTokens = lfm2VlVisualTokenCount(256, 256, 16, 2);

    expect(visualTokens).toBe(controls.max_image_tokens);
    expect(visualTokens).toBeLessThan(INFERENCE_CONFIG.contextTokens);
  });

  it("reports measured multimodal input and image-placeholder counts on overflow", () => {
    expect(multimodalBudgetMessage(257, 256, 64)).toBe(
      "Prepared multimodal input 257 > application budget 256 (64 image placeholders)"
    );
  });
});
