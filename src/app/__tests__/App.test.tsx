// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { InferenceClientPort } from "../../inference/client";
import type { BrowserCapability, ClassificationResult, ProgressEvent } from "../../types";
import { App } from "../App";

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    writable: true,
    value: vi.fn(async () => ({ width: 640, height: 480, close: vi.fn() })),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    writable: true,
    value: vi.fn(() => null),
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
});

afterEach(cleanup);

class UiClient implements InferenceClientPort {
  readonly name = "ui-test";
  prepare = vi.fn(async (progress?: (event: ProgressEvent) => void) => {
    progress?.({ event: "status", stage: "ready", message: "Ready", progress: 100, elapsedMs: 1 });
  });
  probe = vi.fn(async (): Promise<BrowserCapability> => ({
    supported: true,
    secureContext: true,
    hasWebgpu: true,
    adapterAcquired: true,
    deviceAcquired: true,
    shaderF16: true,
  }));
  loadImage = vi.fn(async () => undefined);
  releaseImage = vi.fn(async () => undefined);
  classify = vi.fn(async (): Promise<ClassificationResult> => {
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
    expect(screen.getAllByText(/webgpu is available/i)).not.toHaveLength(0);

    await userEvent.click(loadButton);
    await waitFor(() => expect(client.prepare).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Model ready")).toBeTruthy();
  });

  it("keeps cancellation unavailable outside classification", async () => {
    renderApp(new UiClient());
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(cancel.hasAttribute("disabled")).toBe(true);
  });

  it("uses one Dropzone picker for Browse and the primary choose-image action", async () => {
    const client = new UiClient();
    const { container } = renderApp(client);

    await userEvent.click(await screen.findByRole("button", { name: /load model/i }));
    await screen.findByText("Model ready");

    const inputs = container.querySelectorAll('input[type="file"]');
    expect(inputs).toHaveLength(1);
    const picker = inputs[0] as HTMLInputElement;
    const pickerClick = vi.spyOn(picker, "click");

    await userEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(pickerClick).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Choose an image" }));
    expect(pickerClick).toHaveBeenCalledTimes(2);
  });

  it("continues loading the same selected file through the Dropzone picker", async () => {
    const client = new UiClient();
    const { container } = renderApp(client);
    const file = new File([new Uint8Array(128)], "sample.png", { type: "image/png" });

    await userEvent.click(await screen.findByRole("button", { name: /load model/i }));
    await screen.findByText("Model ready");

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() => expect(client.loadImage).toHaveBeenCalledTimes(1));
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() => expect(client.loadImage).toHaveBeenCalledTimes(2));
  });

  it("keeps the Dropzone picker disabled while the application is busy", async () => {
    const client = new UiClient();
    let finishPreparing: (() => void) | undefined;
    client.prepare.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishPreparing = resolve;
        })
    );
    const { container } = renderApp(client);

    await userEvent.click(await screen.findByRole("button", { name: /load model/i }));
    const browse = screen.getByRole("button", { name: "Browse" });
    await waitFor(() => expect(browse.hasAttribute("disabled")).toBe(true));

    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(container.querySelector('[data-disabled="true"]')).not.toBeNull();
    fireEvent.change(picker, {
      target: { files: [new File(["image"], "sample.png", { type: "image/png" })] },
    });
    expect(client.loadImage).not.toHaveBeenCalled();

    finishPreparing?.();
    await screen.findByText("Model ready");
  });

  it("retains the existing rejection notification copy", async () => {
    const client = new UiClient();
    const show = vi.spyOn(notifications, "show");
    const { container } = renderApp(client);

    await screen.findByRole("button", { name: /load model/i });
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, {
      target: { files: [new File(["gif"], "sample.gif", { type: "image/gif" })] },
    });

    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Image rejected",
          message: "Use a static JPEG, PNG, or WebP within the configured size limit.",
          color: "red",
        })
      )
    );
    show.mockRestore();
  });

  it("shows the persistent unsupported-browser alert without a duplicate failure notification", async () => {
    const client = new UiClient();
    client.probe.mockResolvedValue({
      supported: false,
      secureContext: true,
      hasWebgpu: false,
      adapterAcquired: false,
      deviceAcquired: false,
      shaderF16: false,
      reason: "WebGPU is unavailable",
    });
    const show = vi.spyOn(notifications, "show");
    renderApp(client);

    expect(await screen.findByText("Browser inference unavailable")).toBeTruthy();
    expect(show).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /retry capability check/i }));
    await waitFor(() => expect(client.probe).toHaveBeenCalledTimes(2));
    expect(show).not.toHaveBeenCalled();
    show.mockRestore();
  });
});
