import type { ModelManifest } from "../domain/schemas";
import type { BrowserCapability, InferenceConfig } from "../types";

export const MODEL_MODULES = ["embed_tokens", "vision_encoder", "decoder_model_merged"] as const;
export type ModelModule = (typeof MODEL_MODULES)[number];
export type ModelDtype = "fp32" | "fp16" | "q4" | "q4f16" | "q8";
export type ModelDevice = "webgpu" | "wasm";
export type DtypeProfile = Record<ModelModule, ModelDtype>;
export type DeviceProfile = Record<ModelModule, ModelDevice>;

export interface ExecutionProfile {
  id: string;
  dtype: DtypeProfile;
  device: DeviceProfile;
}

export type ModuleExecutionOption = Readonly<{
  value: string;
  label: string;
  dtype: ModelDtype;
  device: ModelDevice;
  available: boolean;
  reason?: string;
}>;

const DTYPE_ORDER: readonly ModelDtype[] = ["fp16", "q4f16", "q4", "q8", "fp32"];
const DEVICE_ORDER: readonly ModelDevice[] = ["webgpu", "wasm"];
const DISPLAY_MODULES: readonly ModelModule[] = [
  "vision_encoder",
  "decoder_model_merged",
  "embed_tokens",
];
const ROLE_BY_MODULE = {
  embed_tokens: "embedding",
  vision_encoder: "vision",
  decoder_model_merged: "decoder",
} as const;

export class InvalidExecutionProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExecutionProfileError";
  }
}

export function executionOptionValue(dtype: ModelDtype, device: ModelDevice): string {
  return `${dtype}:${device}`;
}

export function parseExecutionOption(value: string): Readonly<{
  dtype: ModelDtype;
  device: ModelDevice;
}> {
  const [dtype, device, extra] = value.split(":");

  if (
    extra !== undefined ||
    !DTYPE_ORDER.includes(dtype as ModelDtype) ||
    !DEVICE_ORDER.includes(device as ModelDevice)
  ) {
    throw new InvalidExecutionProfileError(`Unknown execution option: ${value}`);
  }

  return { dtype: dtype as ModelDtype, device: device as ModelDevice };
}

export function createExecutionProfile(
  dtype: DtypeProfile,
  device: DeviceProfile
): ExecutionProfile {
  return {
    id: MODEL_MODULES.map((module) => `${module}=${dtype[module]}-${device[module]}`).join(";"),
    dtype,
    device,
  };
}

export function updateExecutionProfile(
  profile: ExecutionProfile,
  module: ModelModule,
  option: Readonly<{ dtype: ModelDtype; device: ModelDevice }>
): ExecutionProfile {
  return createExecutionProfile(
    { ...profile.dtype, [module]: option.dtype },
    { ...profile.device, [module]: option.device }
  );
}

export function selectExecutionProfile(
  capability: BrowserCapability,
  configuredDtype: InferenceConfig["model"]["dtype"]
): ExecutionProfile {
  if (capability.shaderF16) {
    return createExecutionProfile(configuredDtype, {
      embed_tokens: "webgpu",
      vision_encoder: "webgpu",
      decoder_model_merged: "webgpu",
    });
  }

  return createExecutionProfile(
    { embed_tokens: "q4", vision_encoder: "q4", decoder_model_merged: "q4" },
    { embed_tokens: "webgpu", vision_encoder: "webgpu", decoder_model_merged: "webgpu" }
  );
}

export function availableDtypesForModule(
  manifest: ModelManifest,
  module: ModelModule
): readonly ModelDtype[] {
  const role = ROLE_BY_MODULE[module];
  const exported = new Set<ModelDtype>();

  for (const artifact of manifest.artifacts) {
    if (artifact.role === role && artifact.dtype) exported.add(artifact.dtype);
  }

  return DTYPE_ORDER.filter((dtype) => exported.has(dtype));
}

function unavailableReason(
  capability: BrowserCapability,
  profile: ExecutionProfile,
  module: ModelModule,
  dtype: ModelDtype,
  device: ModelDevice
): string | undefined {
  if (device === "webgpu" && !capability.supported) {
    return capability.reason ?? "WebGPU is unavailable";
  }
  if (device === "webgpu" && dtype === "q8") {
    return "Q8 is not supported by this model's WebGPU path";
  }
  if (
    device === "webgpu" &&
    (dtype === "fp16" || dtype === "q4f16") &&
    !capability.shaderF16
  ) {
    return "Requires the WebGPU shader-f16 feature";
  }

  const proposed = updateExecutionProfile(profile, module, { dtype, device });

  if (
    proposed.device.decoder_model_merged === "wasm" &&
    proposed.device.vision_encoder === "webgpu"
  ) {
    return "Decoder CPU with vision WebGPU is not offered";
  }

  return undefined;
}

export function moduleExecutionOptions(
  manifest: ModelManifest,
  capability: BrowserCapability,
  profile: ExecutionProfile,
  module: ModelModule
): readonly ModuleExecutionOption[] {
  const options: ModuleExecutionOption[] = [];

  for (const device of DEVICE_ORDER) {
    for (const dtype of availableDtypesForModule(manifest, module)) {
      const reason = unavailableReason(capability, profile, module, dtype, device);

      options.push({
        value: executionOptionValue(dtype, device),
        label: `${dtype.toUpperCase()} (${device === "webgpu" ? "WebGPU" : "CPU / WASM"})`,
        dtype,
        device,
        available: reason === undefined,
        ...(reason ? { reason } : {}),
      });
    }
  }

  return options;
}

export function assertExecutionProfileCompatible(
  capability: BrowserCapability,
  profile: ExecutionProfile,
  manifest?: ModelManifest
): void {
  for (const module of MODEL_MODULES) {
    if (manifest && !availableDtypesForModule(manifest, module).includes(profile.dtype[module])) {
      throw new InvalidExecutionProfileError(
        `${profile.dtype[module]} is not exported for ${module}`
      );
    }

    const reason = unavailableReason(
      capability,
      profile,
      module,
      profile.dtype[module],
      profile.device[module]
    );

    if (reason) throw new InvalidExecutionProfileError(`${module}: ${reason}`);
  }
}

export function profileUsesWebGpu(profile: ExecutionProfile): boolean {
  return MODEL_MODULES.some((module) => profile.device[module] === "webgpu");
}

export function describeExecutionProfile(profile: ExecutionProfile): string {
  return DISPLAY_MODULES.map((module) => {
    const label =
      module === "embed_tokens"
        ? "embeddings"
        : module === "vision_encoder"
          ? "vision"
          : "decoder";

    return `${label} ${profile.dtype[module].toUpperCase()} ${profile.device[module]}`;
  }).join(" | ");
}
