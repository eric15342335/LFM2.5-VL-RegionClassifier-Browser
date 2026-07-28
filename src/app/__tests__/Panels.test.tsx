// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ClassificationResult } from "../../types";
import { DiagnosticsPanel } from "../DiagnosticsPanel";
import { ResultPanel } from "../ResultPanel";

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    writable: true,
    value: vi.fn(() => ({ drawImage: vi.fn() })),
  });
});

const result: ClassificationResult & { browser: { roundTripMs: number } } = {
  requestId: "request-1",
  imageId: "image-1",
  label: "traffic light",
  tokenProbability: 0.91,
  selection: { box: [0.1, 0.2, 0.5, 0.6] },
  crop: {
    selectionBox: [0.1, 0.2, 0.5, 0.6],
    selectionPixels: [64, 96, 320, 288],
    cropBox: [32, 72, 352, 312],
    cropPixels: [32, 72, 352, 312],
    sourceSize: [640, 480],
    cropSizeBeforeResize: [320, 240],
    modelImageSize: [512, 512],
    selectedAreaPixels: 49_152,
    cropAreaPixels: 76_800,
    selectedFractionOfSource: 0.16,
    selectedFractionOfCrop: 0.64,
    paddingRatio: 0.1,
    resampling: "bilinear",
    prepareMs: 10,
  },
  generation: {
    rawOutput: "traffic light",
    finishReason: "stop",
    tokenLogprobs: [-0.09],
    usage: {},
  },
  performance: {
    preprocessMs: 10,
    inferenceMs: 30,
    totalMs: 40,
    sourceBytes: 128,
    encodedJpegBytes: 96,
  },
  runtime: {
    executionLocation: "browser",
    engine: "Transformers.js WebGPU",
    device: "webgpu",
    model: "LiquidAI/LFM2.5-VL-1.6B",
    revision: "main",
    transformersJsVersion: "4.2.0",
  },
  browser: { roundTripMs: 40 },
};

describe("result and diagnostics presentation", () => {
  it("keeps the detected subject prominent without duplicating raw output or runtime status", async () => {
    render(
      <MantineProvider>
        <ResultPanel
          result={result}
          image={null}
        />
      </MantineProvider>
    );

    expect(await screen.findByRole("heading", { name: "traffic light" })).toBeTruthy();
    expect(screen.queryByText(/Raw generation:/i)).toBeNull();
    expect(screen.queryByText("Local WebGPU")).toBeNull();
    expect(screen.getByText("Inference")).toBeTruthy();
    expect(screen.queryByText("WebGPU inference")).toBeNull();
  });

  it("keeps raw result and technical diagnostics available without a decorative session badge", () => {
    render(
      <MantineProvider>
        <DiagnosticsPanel
          capability={null}
          events={[]}
          result={result}
          technicalError="Detailed technical error"
          onClearEvents={vi.fn()}
        />
      </MantineProvider>
    );

    expect(screen.getByText("Technical error")).toBeTruthy();
    expect(screen.getByText("Detailed technical error")).toBeTruthy();
    expect(screen.getByText("Raw result")).toBeTruthy();
    expect(screen.getByText(/"rawOutput": "traffic light"/)).toBeTruthy();
    expect(screen.queryByText("Browser session")).toBeNull();
  });
});
