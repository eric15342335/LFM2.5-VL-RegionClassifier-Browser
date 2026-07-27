export type UiState =
  | "probing"
  | "model-required"
  | "model-loading"
  | "image-required"
  | "selection-required"
  | "ready"
  | "classifying"
  | "success"
  | "model-error"
  | "inference-error"
  | "cancelled";

export type ProgressMode = "idle" | "model" | "inference";

export type Operation = "idle" | "image-loading" | "model-loading" | "classifying";

export type Outcome = "none" | "success" | "model-error" | "inference-error" | "cancelled";

export type StageStatus = "idle" | "active" | "failed" | "cancelled";

export type StageDefinition = Readonly<{
  id: string;
  label: string;
}>;

export const MODEL_STAGES = [
  { id: "probe", label: "Capability" },
  { id: "download", label: "Download" },
  { id: "compile", label: "Compile" },
  { id: "warmup", label: "Warm up" },
  { id: "ready", label: "Ready" },
] as const satisfies readonly StageDefinition[];

export const INFERENCE_STAGES = [
  { id: "accepted", label: "Accepted" },
  { id: "crop", label: "Preprocess" },
  { id: "inference", label: "WebGPU" },
  { id: "complete", label: "Complete" },
] as const satisfies readonly StageDefinition[];

export type UiStateInput = Readonly<{
  capability: "probing" | "available" | "unavailable";
  operation: Operation;
  outcome: Outcome;
  modelPrepared: boolean;
  hasImage: boolean;
  hasSelection: boolean;
}>;

export type PrimaryAction = Readonly<{
  label: string;
  enabled: boolean;
  intent: "none" | "load-model" | "choose-image" | "focus-selection" | "classify";
}>;

export function deriveUiState(input: UiStateInput): UiState {
  if (input.capability === "probing") return "probing";
  if (input.operation === "model-loading") return "model-loading";
  if (input.operation === "classifying") return "classifying";
  if (input.outcome === "model-error" || input.capability === "unavailable") return "model-error";
  if (input.outcome === "inference-error") return "inference-error";
  if (input.outcome === "cancelled") return "cancelled";
  if (!input.modelPrepared) return "model-required";
  if (!input.hasImage) return "image-required";
  if (!input.hasSelection) return "selection-required";
  return input.outcome === "success" ? "success" : "ready";
}

export function primaryActionFor(
  state: UiState,
  modelSize: string,
  imageLoading = false,
  supported = true
): PrimaryAction {
  if (imageLoading) return { label: "Preparing image...", enabled: false, intent: "none" };

  switch (state) {
    case "probing":
      return { label: "Checking browser...", enabled: false, intent: "none" };
    case "model-required":
      return { label: `Load model (${modelSize})`, enabled: supported, intent: "load-model" };
    case "model-loading":
      return { label: "Loading model...", enabled: false, intent: "none" };
    case "image-required":
      return { label: "Choose an image", enabled: true, intent: "choose-image" };
    case "selection-required":
      return { label: "Draw around an object", enabled: true, intent: "focus-selection" };
    case "ready":
      return { label: "Classify selection", enabled: true, intent: "classify" };
    case "success":
      return { label: "Classify again", enabled: true, intent: "classify" };
    case "model-error":
      return {
        label: supported ? "Retry model load" : "WebGPU unavailable",
        enabled: supported,
        intent: supported ? "load-model" : "none",
      };
    case "inference-error":
      return { label: "Try again", enabled: true, intent: "classify" };
    case "cancelled":
      return { label: "Classify selection", enabled: true, intent: "classify" };
    case "classifying":
      return { label: "Classifying...", enabled: false, intent: "none" };
  }
}

export function stagesFor(mode: ProgressMode): readonly StageDefinition[] {
  if (mode === "model") return MODEL_STAGES;
  if (mode === "inference") return INFERENCE_STAGES;
  return [];
}

export function normalizeWorkerStage(mode: ProgressMode, stage: string): string | null {
  if (mode === "model") {
    if (stage === "install") return "download";
    return MODEL_STAGES.some((candidate) => candidate.id === stage) ? stage : null;
  }

  if (mode === "inference") {
    if (stage === "queued" || stage === "recovery") return "accepted";
    return INFERENCE_STAGES.some((candidate) => candidate.id === stage) ? stage : null;
  }

  return null;
}

export function progressModeForWorkerStage(stage: string): ProgressMode {
  if (["probe", "install", "compile", "warmup", "ready"].includes(stage)) return "model";
  if (["accepted", "crop", "inference", "complete", "queued", "recovery"].includes(stage)) {
    return "inference";
  }
  return "idle";
}

export function stageIndex(mode: ProgressMode, stage: string | null): number {
  if (!stage) return -1;
  return stagesFor(mode).findIndex((candidate) => candidate.id === stage);
}
