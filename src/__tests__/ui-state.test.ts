import { describe, expect, it } from "vitest";
import {
  deriveUiState,
  MODEL_STAGES,
  normalizeWorkerStage,
  primaryActionFor,
  progressModeForWorkerStage,
  stagesFor,
} from "../ui-state";

describe("UI state and progress mapping", () => {
  it("derives a single progression from capability through success", () => {
    expect(
      deriveUiState({
        capability: "probing",
        operation: "idle",
        outcome: "none",
        modelPrepared: false,
        hasImage: false,
        hasSelection: false,
      })
    ).toBe("probing");
    expect(
      deriveUiState({
        capability: "available",
        operation: "idle",
        outcome: "none",
        modelPrepared: false,
        hasImage: true,
        hasSelection: false,
      })
    ).toBe("model-required");
    expect(
      deriveUiState({
        capability: "available",
        operation: "idle",
        outcome: "none",
        modelPrepared: true,
        hasImage: true,
        hasSelection: true,
      })
    ).toBe("ready");
  });

  it("preserves model and inference terminal states for clear recovery actions", () => {
    const base = {
      capability: "available" as const,
      operation: "idle" as const,
      modelPrepared: true,
      hasImage: true,
      hasSelection: true,
    };
    expect(deriveUiState({ ...base, outcome: "model-error" })).toBe("model-error");
    expect(deriveUiState({ ...base, outcome: "inference-error" })).toBe("inference-error");
    expect(deriveUiState({ ...base, outcome: "cancelled" })).toBe("cancelled");
    expect(deriveUiState({ ...base, outcome: "success" })).toBe("success");
    expect(deriveUiState({ ...base, outcome: "none", operation: "model-loading" })).toBe(
      "model-loading"
    );
    expect(deriveUiState({ ...base, outcome: "none", operation: "classifying" })).toBe(
      "classifying"
    );
  });

  it("keeps model and inference workflows separate", () => {
    expect(MODEL_STAGES.map((stage) => stage.label)).toEqual([
      "Capability",
      "Download",
      "Compile",
      "Warm up",
      "Ready",
    ]);
    expect(stagesFor("inference").map((stage) => stage.label)).toEqual([
      "Accepted",
      "Preprocess",
      "WebGPU",
      "Complete",
    ]);
    expect(normalizeWorkerStage("model", "install")).toBe("download");
    expect(normalizeWorkerStage("inference", "queued")).toBe("accepted");
    expect(normalizeWorkerStage("inference", "recovery")).toBe("accepted");
    expect(normalizeWorkerStage("inference", "warmup")).toBeNull();
    expect(progressModeForWorkerStage("warmup")).toBe("model");
    expect(progressModeForWorkerStage("complete")).toBe("inference");
    expect(progressModeForWorkerStage("unknown")).toBe("idle");
  });

  it("maps each state to one primary action", () => {
    expect(primaryActionFor("model-required", "544 MiB")).toMatchObject({
      label: "Load model (544 MiB)",
      intent: "load-model",
      enabled: true,
    });
    expect(primaryActionFor("selection-required", "544 MiB")).toMatchObject({
      label: "Draw around an object",
      intent: "focus-selection",
    });
    expect(primaryActionFor("model-error", "544 MiB", false, false)).toMatchObject({
      label: "WebGPU unavailable",
      enabled: false,
    });
    expect(primaryActionFor("image-required", "544 MiB")).toMatchObject({
      label: "Choose an image",
      intent: "choose-image",
    });
    expect(primaryActionFor("ready", "544 MiB")).toMatchObject({
      label: "Classify selection",
      intent: "classify",
    });
    expect(primaryActionFor("success", "544 MiB")).toMatchObject({
      label: "Classify again",
      intent: "classify",
    });
    expect(primaryActionFor("inference-error", "544 MiB")).toMatchObject({
      label: "Try again",
      intent: "classify",
    });
    expect(primaryActionFor("model-loading", "544 MiB")).toMatchObject({
      label: "Loading model...",
      enabled: false,
    });
  });
});
