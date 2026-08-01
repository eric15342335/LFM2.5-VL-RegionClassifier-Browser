// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MINIMUM_SELECTION_SPAN } from "../../selection-geometry";
import type { NormalizedSelection } from "../../types";
import type { LoadedImage } from "../app.machine";
import { ImageWorkspace } from "../ImageWorkspace";

beforeAll(() => {
  Object.defineProperty(window, "PointerEvent", {
    writable: true,
    value: MouseEvent,
  });

  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    writable: true,
    value: vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
    })),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "getBoundingClientRect", {
    writable: true,
    value: function (this: HTMLCanvasElement) {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: this.width,
        bottom: this.height,
        width: this.width,
        height: this.height,
        toJSON: () => undefined,
      };
    },
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

const image = {
  descriptor: {
    id: "image-1",
    name: "sample.png",
    mimeType: "image/png",
    bytes: 128,
    width: 640,
    height: 480,
  },
  previewBitmap: { width: 640, height: 480 } as ImageBitmap,
} satisfies LoadedImage;

const standardSelection: NormalizedSelection = { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 };

function renderWorkspace(
  options: Readonly<{
    selection?: NormalizedSelection | null;
    coordinatesOpen?: boolean;
    disabled?: boolean;
  }> = {}
) {
  const onSelectionChange = vi.fn();
  const onSelectionComplete = vi.fn();
  const rendered = render(
    <MantineProvider>
      <ImageWorkspace
        image={image}
        selection={options.selection ?? null}
        disabled={options.disabled ?? false}
        coordinatesOpen={options.coordinatesOpen ?? false}
        onCoordinatesOpenChange={vi.fn()}
        onSelectionChange={onSelectionChange}
        onSelectionComplete={onSelectionComplete}
      />
    </MantineProvider>
  );
  const canvas = screen.getByLabelText("Image selection workspace");
  const cropWrapper = rendered.container.querySelector(
    ".ReactCrop__child-wrapper"
  ) as HTMLDivElement;

  vi.spyOn(cropWrapper, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 640,
    bottom: 480,
    width: 640,
    height: 480,
    toJSON: () => undefined,
  });

  return { ...rendered, canvas, onSelectionChange, onSelectionComplete };
}

describe("ImageWorkspace", () => {
  it("publishes a selection ReactCrop creates from an initially empty workspace", async () => {
    const { canvas, container, onSelectionChange, onSelectionComplete } = renderWorkspace();

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      clientX: 64,
      clientY: 48,
    });
    await waitFor(() =>
      expect(container.querySelector(".ReactCrop__crop-selection")).not.toBeNull()
    );
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 320, clientY: 240 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 320, clientY: 240 });

    await waitFor(() =>
      expect(onSelectionComplete).toHaveBeenLastCalledWith({
        x1: 0.1,
        y1: 0.1,
        x2: 0.5,
        y2: 0.5,
      })
    );
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("publishes movement of an existing selection through ReactCrop", async () => {
    const { onSelectionChange, onSelectionComplete } = renderWorkspace({
      selection: standardSelection,
    });
    const cropArea = screen.getByRole("group", { name: "Rectangular image selection" });

    fireEvent.pointerDown(cropArea, { pointerId: 1, clientX: 128, clientY: 96 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 192, clientY: 144 });
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith({ x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.6 })
    );
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 192, clientY: 144 });

    await waitFor(() =>
      expect(onSelectionComplete).toHaveBeenLastCalledWith({
        x1: 0.2,
        y1: 0.2,
        x2: 0.6,
        y2: 0.6,
      })
    );
  });

  it("publishes resizing from a ReactCrop handle", async () => {
    const { onSelectionChange, onSelectionComplete } = renderWorkspace({
      selection: standardSelection,
    });
    const handle = screen.getByRole("button", { name: "Resize selection from bottom right" });

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 320, clientY: 240 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 384, clientY: 288 });
    await waitFor(() =>
      expect(onSelectionChange).toHaveBeenLastCalledWith({ x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.6 })
    );
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 384, clientY: 288 });

    await waitFor(() =>
      expect(onSelectionComplete).toHaveBeenLastCalledWith({
        x1: 0.1,
        y1: 0.1,
        x2: 0.6,
        y2: 0.6,
      })
    );
  });

  it("replaces an existing selection when dragging outside it", async () => {
    const { canvas, container, onSelectionComplete } = renderWorkspace({
      selection: standardSelection,
    });

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 384, clientY: 288 });
    await waitFor(() =>
      expect(
        container.querySelector(".ReactCrop__crop-selection")?.getAttribute("style")
      ).toContain("left: 60%")
    );
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 576, clientY: 432 });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 576, clientY: 432 });

    await waitFor(() =>
      expect(onSelectionComplete).toHaveBeenLastCalledWith({
        x1: 0.6,
        y1: 0.6,
        x2: 0.9,
        y2: 0.9,
      })
    );
  });

  it("converts the normalized minimum span into ReactCrop pixel constraints", async () => {
    const { canvas, container, onSelectionComplete } = renderWorkspace();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 64, clientY: 48 });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 65, clientY: 49 });
    await waitFor(() =>
      expect(
        container.querySelector(".ReactCrop__crop-selection")?.getAttribute("style")
      ).toContain("width: 1%")
    );
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 65, clientY: 49 });

    await waitFor(() => expect(onSelectionComplete).toHaveBeenCalled());
    const [minimumSelection] = onSelectionComplete.mock.calls.at(-1) as [NormalizedSelection];

    expect(minimumSelection.x2 - minimumSelection.x1).toBeCloseTo(MINIMUM_SELECTION_SPAN);
    expect(minimumSelection.y2 - minimumSelection.y1).toBeCloseTo(MINIMUM_SELECTION_SPAN);
  });

  it("restores an existing selection after a cancelled touch-style drag", async () => {
    const { container, onSelectionChange, onSelectionComplete } = renderWorkspace({
      selection: standardSelection,
    });
    const cropArea = screen.getByRole("group", { name: "Rectangular image selection" });

    fireEvent.pointerDown(cropArea, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 128,
      clientY: 96,
    });
    fireEvent.pointerMove(document, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 192,
      clientY: 144,
    });
    fireEvent.pointerCancel(document, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 192,
      clientY: 144,
    });

    await waitFor(() =>
      expect(container.querySelector(".ReactCrop__crop-selection")).not.toBeNull()
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith(standardSelection);
    expect(onSelectionComplete).not.toHaveBeenCalled();
  });

  it("completes a touch-style crop selection", async () => {
    const { canvas, onSelectionComplete } = renderWorkspace();

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 64,
      clientY: 48,
    });
    fireEvent.pointerMove(document, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 320,
      clientY: 240,
    });
    fireEvent.pointerUp(document, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 320,
      clientY: 240,
    });

    await waitFor(() =>
      expect(onSelectionComplete).toHaveBeenLastCalledWith({
        x1: 0.1,
        y1: 0.1,
        x2: 0.5,
        y2: 0.5,
      })
    );
  });

  it("supports ReactCrop keyboard movement and handle resizing", async () => {
    const { onSelectionChange, onSelectionComplete } = renderWorkspace({
      selection: standardSelection,
    });
    const cropArea = screen.getByRole("group", { name: "Rectangular image selection" });

    fireEvent.keyDown(cropArea, { key: "ArrowRight" });
    await waitFor(() => expect(onSelectionChange).toHaveBeenCalled());
    const [movedSelection] = onSelectionChange.mock.calls.at(-1) as [NormalizedSelection];

    expect(movedSelection.x1).toBeCloseTo(0.1 + 1 / 640);
    expect(movedSelection.x2).toBeCloseTo(0.5 + 1 / 640);
    expect(onSelectionComplete).toHaveBeenLastCalledWith(movedSelection);

    const eastHandle = screen.getByRole("button", { name: "Resize selection from right" });

    fireEvent.keyDown(eastHandle, { key: "ArrowRight", shiftKey: true });
    await waitFor(() => expect(onSelectionChange.mock.calls).toHaveLength(2));
    const [resizedSelection] = onSelectionChange.mock.calls.at(-1) as [NormalizedSelection];

    expect(resizedSelection.x2).toBeGreaterThan(movedSelection.x2);
    expect(onSelectionComplete).toHaveBeenLastCalledWith(resizedSelection);
  });

  it("keeps coordinate entry as an alternate normalized selection input", async () => {
    const { onSelectionComplete } = renderWorkspace({ coordinatesOpen: true });

    fireEvent.change(screen.getByLabelText("X1 %"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Y1 %"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("X2 %"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Y2 %"), { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply selection" }));

    await waitFor(() =>
      expect(onSelectionComplete).toHaveBeenLastCalledWith({ x1: 0.2, y1: 0.3, x2: 0.8, y2: 0.9 })
    );
  });
});
