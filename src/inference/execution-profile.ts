import type { BrowserCapability, InferenceConfig } from "../types";

export const MODEL_MODULES = ["embed_tokens", "vision_encoder", "decoder_model_merged"] as const;
export type ModelModule = (typeof MODEL_MODULES)[number];
export type ModelDtype = "fp32" | "fp16" | "q4" | "q4f16" | "q8";
export type ModelDevice = "webgpu" | "wasm";
export type DtypeProfile = Record<ModelModule, ModelDtype>;
export interface ExecutionProfile {
  id: "webgpu-f16" | "wasm-fp32-embed-no-shader-f16";
  dtype: DtypeProfile;
  device: Record<ModelModule, ModelDevice>;
}

export class InvalidExecutionProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExecutionProfileError";
  }
}

export function selectExecutionProfile(
  capability: BrowserCapability,
  configuredDtype: InferenceConfig["model"]["dtype"]
): ExecutionProfile {
  return capability.shaderF16
    ? {
        id: "webgpu-f16",
        dtype: configuredDtype,
        device: {
          embed_tokens: "webgpu",
          vision_encoder: "webgpu",
          decoder_model_merged: "webgpu",
        },
      }
    : {
        id: "wasm-fp32-embed-no-shader-f16",
        dtype: { embed_tokens: "fp32", vision_encoder: "q8", decoder_model_merged: "q8" },
        device: { embed_tokens: "wasm", vision_encoder: "wasm", decoder_model_merged: "wasm" },
      };
}

export function assertExecutionProfileCompatible(
  capability: BrowserCapability,
  profile: ExecutionProfile
): void {
  for (const module of MODEL_MODULES) {
    if (
      profile.device[module] === "webgpu" &&
      (profile.dtype[module] === "fp16" || profile.dtype[module] === "q4f16") &&
      !capability.shaderF16
    )
      throw new InvalidExecutionProfileError(`${module} requires shader-f16 on WebGPU`);

    const fallbackDtype = module === "embed_tokens" ? "fp32" : "q8";

    if (
      !capability.shaderF16 &&
      (profile.dtype[module] !== fallbackDtype || profile.device[module] !== "wasm")
    )
      throw new InvalidExecutionProfileError(
        "The no-shader-f16 profile must use FP32 embeddings and Q8 on WASM"
      );
  }
}

export function profileUsesWebGpu(profile: ExecutionProfile): boolean {
  return MODEL_MODULES.some((module) => profile.device[module] === "webgpu");
}
