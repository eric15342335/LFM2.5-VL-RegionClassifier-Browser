// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { InferenceClientPort } from "../../inference/client";
import type {
  BrowserCapability,
  ClassificationResult,
  ClassifyRequest,
  ImageDescriptor,
  ProgressEvent,
} from "../../types";
import { App } from "../App";

beforeAll(() => {
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
});

class UiClient implements InferenceClientPort {
  readonly name = "ui-test";
  prepared = false;
  prepare = vi.fn(async (progress?: (event: ProgressEvent) => void) => {
    progress?.({ event: "status", stage: "ready", message: "Ready", progress: 100, elapsedMs: 1 });
    this.prepared = true;
  });
  probe = vi.fn(async (): Promise<BrowserCapability> => ({
    supported: true,
    secureContext: true,
    hasWebgpu: true,
    adapterAcquired: true,
    deviceAcquired: true,
    shaderF16: true,
  }));
  isPrepared = () => this.prepared;
  loadImage = vi.fn(async (_file: File, _descriptor: ImageDescriptor) => undefined);
  releaseImage = vi.fn(async () => undefined);
  classify = vi.fn(async (_request: ClassifyRequest): Promise<ClassificationResult> => {
    throw new Error("not used");
  });
  cancel = vi.fn();
  dispose = vi.fn(async () => undefined);
  subscribeLifecycle = vi.fn(() => () => undefined);
}

function renderApp(client: UiClient) {
  return render(
    <MantineProvider>
      <App inferenceClient={client} />
    </MantineProvider>
  );
}

describe("App", () => {
  it("exposes accessible model and image controls after capability probing", async () => {
    const client = new UiClient();
    renderApp(client);

    const loadButton = await screen.findByRole("button", { name: /load model/i });
    expect(screen.getByRole("button", { name: /browse/i }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/webgpu is available/i)).toBeTruthy();

    await userEvent.click(loadButton);
    await waitFor(() => expect(client.prepare).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Model ready")).toBeTruthy();
  });

  it("keeps cancellation unavailable outside classification", async () => {
    renderApp(new UiClient());
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(cancel.hasAttribute("disabled")).toBe(true);
  });
});
