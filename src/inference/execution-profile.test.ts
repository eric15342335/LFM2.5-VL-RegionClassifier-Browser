import { describe, expect, it } from "vitest";
import { INFERENCE_CONFIG } from "../config";
import type { BrowserCapability } from "../types";
import {
  assertExecutionProfileCompatible,
  createExecutionProfile,
  InvalidExecutionProfileError,
  moduleExecutionOptions,
  selectExecutionProfile,
  updateExecutionProfile,
} from "./execution-profile";

const capability: BrowserCapability = {
  supported: true,
  secureContext: true,
  hasWebgpu: true,
  adapterAcquired: true,
  deviceAcquired: true,
  shaderF16: true,
};

describe("execution profiles", () => {
  it("uses configured mixed precision on WebGPU with shader-f16", () => {
    expect(selectExecutionProfile(capability, INFERENCE_CONFIG.model.dtype)).toMatchObject({
      dtype: INFERENCE_CONFIG.model.dtype,
      device: {
        embed_tokens: "webgpu",
        vision_encoder: "webgpu",
        decoder_model_merged: "webgpu",
      },
    });
  });

  it("uses plain Q4 on WebGPU without shader-f16", () => {
    expect(
      selectExecutionProfile({ ...capability, shaderF16: false }, INFERENCE_CONFIG.model.dtype)
    ).toMatchObject({
      dtype: { embed_tokens: "q4", vision_encoder: "q4", decoder_model_merged: "q4" },
      device: {
        embed_tokens: "webgpu",
        vision_encoder: "webgpu",
        decoder_model_merged: "webgpu",
      },
    });
  });

  it("lists every exported dtype on both devices and disables unsupported choices", () => {
    const noFp16 = { ...capability, shaderF16: false };
    const profile = selectExecutionProfile(noFp16, INFERENCE_CONFIG.model.dtype);
    const options = moduleExecutionOptions(
      INFERENCE_CONFIG.model,
      noFp16,
      profile,
      "vision_encoder"
    );

    expect(options).toHaveLength(10);
    expect(options.find((option) => option.value === "fp16:webgpu")).toMatchObject({
      available: false,
      reason: expect.stringContaining("shader-f16"),
    });
    expect(options.find((option) => option.value === "fp16:wasm")).toMatchObject({
      available: true,
    });
    expect(options.find((option) => option.value === "q8:webgpu")).toMatchObject({
      available: false,
      reason: expect.stringContaining("Q8"),
    });
    expect(options.find((option) => option.value === "q8:wasm")).toMatchObject({
      available: true,
    });
  });

  it.each(["fp16", "q4f16"] as const)(
    "rejects %s on WebGPU without shader-f16",
    (dtype) => {
      const profile = createExecutionProfile(
        { ...INFERENCE_CONFIG.model.dtype, vision_encoder: dtype },
        { embed_tokens: "webgpu", vision_encoder: "webgpu", decoder_model_merged: "webgpu" }
      );

      expect(() =>
        assertExecutionProfileCompatible(
          { ...capability, shaderF16: false },
          profile,
          INFERENCE_CONFIG.model
        )
      ).toThrow(InvalidExecutionProfileError);
    }
  );

  it("keeps decoder CPU visible but disabled until vision moves to CPU", () => {
    const profile = selectExecutionProfile(capability, INFERENCE_CONFIG.model.dtype);
    const before = moduleExecutionOptions(
      INFERENCE_CONFIG.model,
      capability,
      profile,
      "decoder_model_merged"
    );

    expect(before.find((option) => option.value === "q8:wasm")).toMatchObject({
      available: false,
      reason: expect.stringContaining("vision WebGPU"),
    });

    const visionOnCpu = updateExecutionProfile(profile, "vision_encoder", {
      dtype: "q8",
      device: "wasm",
    });
    const after = moduleExecutionOptions(
      INFERENCE_CONFIG.model,
      capability,
      visionOnCpu,
      "decoder_model_merged"
    );

    expect(after.find((option) => option.value === "q8:wasm")).toMatchObject({
      available: true,
    });
  });

  it("allows decoder WebGPU with vision WASM", () => {
    const profile = createExecutionProfile(
      { embed_tokens: "q4", vision_encoder: "q8", decoder_model_merged: "q4" },
      { embed_tokens: "webgpu", vision_encoder: "wasm", decoder_model_merged: "webgpu" }
    );

    expect(() =>
      assertExecutionProfileCompatible(capability, profile, INFERENCE_CONFIG.model)
    ).not.toThrow();
  });

  it("rejects decoder WASM with vision WebGPU", () => {
    const profile = createExecutionProfile(
      { embed_tokens: "q4", vision_encoder: "q4", decoder_model_merged: "q8" },
      { embed_tokens: "wasm", vision_encoder: "webgpu", decoder_model_merged: "wasm" }
    );

    expect(() =>
      assertExecutionProfileCompatible(capability, profile, INFERENCE_CONFIG.model)
    ).toThrow(InvalidExecutionProfileError);
  });

  it("rejects Q8 on WebGPU", () => {
    const profile = createExecutionProfile(
      { embed_tokens: "q4", vision_encoder: "q4", decoder_model_merged: "q8" },
      { embed_tokens: "webgpu", vision_encoder: "webgpu", decoder_model_merged: "webgpu" }
    );

    expect(() =>
      assertExecutionProfileCompatible(capability, profile, INFERENCE_CONFIG.model)
    ).toThrow(InvalidExecutionProfileError);
  });
});
