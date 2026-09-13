import { Box, Button, Collapse, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "react-image-crop/dist/ReactCrop.css";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import {
  isUsableSelection,
  MINIMUM_SELECTION_SPAN,
  normalizedToPercentCrop,
  percentCropToNormalized,
} from "../selection-geometry";
import type { NormalizedSelection } from "../types";
import type { LoadedImage } from "./app.machine";
import { formatBytes } from "./format";

type Props = Readonly<{
  image: LoadedImage;
  selection: NormalizedSelection | null;
  disabled: boolean;
  coordinatesOpen: boolean;
  onCoordinatesOpenChange: (open: boolean) => void;
  onSelectionChange: (selection: NormalizedSelection | null) => void;
  onSelectionComplete: (selection: NormalizedSelection) => void;
}>;

function selectionsEqual(
  left: NormalizedSelection | null,
  right: NormalizedSelection | null
): boolean {
  if (!left || !right) return left === right;

  return (
    left.x1 === right.x1 && left.y1 === right.y1 && left.x2 === right.x2 && left.y2 === right.y2
  );
}

export function ImageWorkspace({
  image,
  selection,
  disabled,
  coordinatesOpen,
  onCoordinatesOpenChange,
  onSelectionChange,
  onSelectionComplete,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const x1Ref = useRef<HTMLInputElement>(null);
  const cancelledCropCompletionRef = useRef(false);
  const selectionBeforeDragRef = useRef<NormalizedSelection | null>(null);
  const [transientCrop, setTransientCrop] = useState<PercentCrop | undefined>();
  const [coordinates, setCoordinates] = useState({ x1: 10, y1: 10, x2: 90, y2: 90 });
  const [renderedCanvasSize, setRenderedCanvasSize] = useState({ width: 0, height: 0 });
  const crop = transientCrop ?? (selection ? normalizedToPercentCrop(selection) : undefined);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    const width = image.previewBitmap.width;
    const height = image.previewBitmap.height;

    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image.previewBitmap, 0, 0);
  }, [image]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      setRenderedCanvasSize({ width: 0, height: 0 });

      return;
    }

    const updateRenderedCanvasSize = () => {
      const { width, height } = canvas.getBoundingClientRect();

      setRenderedCanvasSize((current) =>
        current.width === width && current.height === height ? current : { width, height }
      );
    };

    updateRenderedCanvasSize();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateRenderedCanvasSize);

    observer.observe(canvas);

    return () => observer.disconnect();
  }, [image]);

  useEffect(() => {
    setTransientCrop(undefined);
    if (selection) {
      setCoordinates({
        x1: selection.x1 * 100,
        y1: selection.y1 * 100,
        x2: selection.x2 * 100,
        y2: selection.y2 * 100,
      });
    }
  }, [selection]);

  useEffect(() => {
    if (coordinatesOpen) x1Ref.current?.focus();
  }, [coordinatesOpen]);

  const updateCrop = (percentCrop: PercentCrop) => {
    setTransientCrop(percentCrop);

    const next = percentCropToNormalized(percentCrop);

    if (selection && isUsableSelection(next) && !selectionsEqual(next, selection)) {
      onSelectionChange(next);
    }
  };

  const commitCrop = (percentCrop: PercentCrop) => {
    if (cancelledCropCompletionRef.current) {
      cancelledCropCompletionRef.current = false;

      return;
    }

    selectionBeforeDragRef.current = null;
    const next = percentCropToNormalized(percentCrop);

    if (!isUsableSelection(next)) return;

    setTransientCrop(undefined);
    onSelectionComplete(next);
  };

  const discardIncompleteCrop = () => {
    const currentCrop = transientCrop ?? crop;

    if (!currentCrop || isUsableSelection(percentCropToNormalized(currentCrop))) return;

    setTransientCrop(undefined);
    if (selection !== null) onSelectionChange(null);
  };

  const beginCropDrag = () => {
    selectionBeforeDragRef.current = selection;
  };

  const finishCropDrag = (event: PointerEvent) => {
    if (event.type === "pointercancel") {
      cancelledCropCompletionRef.current = true;
      setTransientCrop(undefined);
      if (selectionBeforeDragRef.current) onSelectionChange(selectionBeforeDragRef.current);
      selectionBeforeDragRef.current = null;

      return;
    }

    discardIncompleteCrop();
  };

  const updateCoordinate = (key: keyof NormalizedSelection, value: string | number) => {
    const numeric = typeof value === "number" ? value : Number(value);

    if (Number.isFinite(numeric))
      setCoordinates((current) => ({ ...current, [key]: Math.max(0, Math.min(100, numeric)) }));
  };

  const applyCoordinates = () => {
    const next = percentCropToNormalized({
      unit: "%",
      x: coordinates.x1,
      y: coordinates.y1,
      width: coordinates.x2 - coordinates.x1,
      height: coordinates.y2 - coordinates.y1,
    });

    setTransientCrop(undefined);

    if (isUsableSelection(next)) onSelectionComplete(next);
    else onSelectionChange(null);
  };

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
    >
      <Stack gap="md">
        <Box>
          <Title
            order={2}
            size="h3"
          >
            Image workspace
          </Title>
          <Text
            size="sm"
            c="dimmed"
          >
            {`${image.descriptor.name} · ${image.descriptor.width} × ${image.descriptor.height} · ${formatBytes(image.descriptor.bytes)}`}
          </Text>
        </Box>

        <Box className="image-canvas-shell">
          <ReactCrop
            crop={crop}
            disabled={disabled}
            minWidth={renderedCanvasSize.width * MINIMUM_SELECTION_SPAN}
            minHeight={renderedCanvasSize.height * MINIMUM_SELECTION_SPAN}
            ariaLabels={{
              cropArea: "Rectangular image selection",
              nwDragHandle: "Resize selection from top left",
              nDragHandle: "Resize selection from top",
              neDragHandle: "Resize selection from top right",
              eDragHandle: "Resize selection from right",
              seDragHandle: "Resize selection from bottom right",
              sDragHandle: "Resize selection from bottom",
              swDragHandle: "Resize selection from bottom left",
              wDragHandle: "Resize selection from left",
            }}
            onChange={(_, percentCrop) => updateCrop(percentCrop)}
            onComplete={(_, percentCrop) => commitCrop(percentCrop)}
            onDragStart={beginCropDrag}
            onDragEnd={finishCropDrag}
          >
            <canvas
              ref={canvasRef}
              className="image-canvas"
              aria-label="Image selection workspace"
            />
          </ReactCrop>
        </Box>

        <Group justify="space-between">
          <Text
            size="sm"
            c="dimmed"
          >
            Draw, move, or resize one rectangular region. Drag outside it to draw a new one.
          </Text>
          <Text
            component="button"
            type="button"
            className="coordinate-toggle"
            onClick={() => onCoordinatesOpenChange(!coordinatesOpen)}
          >
            {coordinatesOpen ? "Hide coordinates" : "Edit coordinates"}
          </Text>
        </Group>

        <Collapse expanded={coordinatesOpen}>
          <Paper
            withBorder
            p="sm"
            radius="md"
          >
            <div className="coordinate-grid">
              {(["x1", "y1", "x2", "y2"] as const).map((key) => (
                <label
                  key={key}
                  className="coordinate-field"
                >
                  <span className="coordinate-label">{key.toUpperCase()} %</span>
                  <input
                    ref={key === "x1" ? x1Ref : undefined}
                    className="coordinate-input"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    step={0.01}
                    value={coordinates[key]}
                    disabled={disabled}
                    aria-label={`${key.toUpperCase()} %`}
                    onChange={(event) => updateCoordinate(key, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
            <Group
              justify="flex-end"
              mt="sm"
            >
              <Button
                size="sm"
                disabled={disabled}
                onClick={applyCoordinates}
              >
                Apply selection
              </Button>
            </Group>
          </Paper>
        </Collapse>
      </Stack>
    </Paper>
  );
}
