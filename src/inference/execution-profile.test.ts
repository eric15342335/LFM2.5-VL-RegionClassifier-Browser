import { describe, expect, it } from "vitest";
import { INFERENCE_CONFIG } from "../config";
import type { BrowserCapability } from "../types";
import {
  assertExecutionProfileCompatible,
  InvalidExecutionProfileError,
  selectExecutionProfile,
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
    expect(selectExecutionProfile(capability, INFERENCE_CONFIG.model.dtype)).toEqual({
      id: "webgpu-f16",
      dtype: INFERENCE_CONFIG.model.dtype,
      device: { embed_tokens: "webgpu", vision_encoder: "webgpu", decoder_model_merged: "webgpu" },
    });
  });

  it("uses FP32 embeddings and Q8 WASM without shader-f16", () => {
    expect(
      selectExecutionProfile({ ...capability, shaderF16: false }, INFERENCE_CONFIG.model.dtype)
    ).toEqual({
      id: "wasm-fp32-embed-no-shader-f16",
      dtype: { embed_tokens: "fp32", vision_encoder: "q8", decoder_model_merged: "q8" },
      device: { embed_tokens: "wasm", vision_encoder: "wasm", decoder_model_merged: "wasm" },
    });
  });

  it.each(["fp16", "q4f16"] as const)("rejects %s on WebGPU without shader-f16", (dtype) => {
    expect(() =>
      assertExecutionProfileCompatible(
        { ...capability, shaderF16: false },
        {
          id: "webgpu-f16",
          dtype: { ...INFERENCE_CONFIG.model.dtype, embed_tokens: dtype },
          device: { embed_tokens: "webgpu", vision_encoder: "wasm", decoder_model_merged: "wasm" },
        }
      )
    ).toThrow(InvalidExecutionProfileError);
  });

  it("rejects a Q8 embedding on WASM without shader-f16", () => {
    expect(() =>
      assertExecutionProfileCompatible(
        { ...capability, shaderF16: false },
        {
          id: "wasm-fp32-embed-no-shader-f16",
          dtype: { embed_tokens: "q8", vision_encoder: "q8", decoder_model_merged: "q8" },
          device: { embed_tokens: "wasm", vision_encoder: "wasm", decoder_model_merged: "wasm" },
        }
      )
    ).toThrow(InvalidExecutionProfileError);
  });
});
