// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

const image = {
  file: new File([new Uint8Array(128)], "sample.png", { type: "image/png" }),
  descriptor: {
    id: "image-1",
    name: "sample.png",
    mimeType: "image/png",
    bytes: 128,
    width: 640,
    height: 480,
  },
  bitmap: { width: 640, height: 480 } as ImageBitmap,
} satisfies LoadedImage;

describe("ImageWorkspace", () => {
  it("publishes a selection drawn from an initially empty workspace", () => {
    const onSelectionChange = vi.fn();
    const onSelectionComplete = vi.fn();
    const { container } = render(
      <MantineProvider>
        <ImageWorkspace
          image={image}
          selection={null}
          disabled={false}
          coordinatesOpen={false}
          onCoordinatesOpenChange={vi.fn()}
          onSelectionChange={onSelectionChange}
          onSelectionComplete={onSelectionComplete}
        />
      </MantineProvider>
    );

    const canvas = screen.getByLabelText("Image selection workspace");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
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

    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      clientX: 64,
      clientY: 48,
    });
    expect(container.querySelector(".ReactCrop__crop-selection")).not.toBeNull();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 320, clientY: 240 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 320, clientY: 240 });

    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(onSelectionComplete).toHaveBeenLastCalledWith({
      x1: 0.1,
      y1: 0.1,
      x2: 0.5,
      y2: 0.5,
    });
  });
});
