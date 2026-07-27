import {
  Box,
  Button,
  Collapse,
  Group,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  canvasPointFromClient,
  isUsableSelection,
  normalizedSelection,
  type Point,
} from "../selection-geometry";
import type { NormalizedSelection, SelectionShape } from "../types";
import type { LoadedImage } from "./app.machine";
import { formatBytes } from "./format";

type Props = Readonly<{
  image: LoadedImage | null;
  selection: NormalizedSelection | null;
  shape: SelectionShape;
  disabled: boolean;
  coordinatesOpen: boolean;
  onCoordinatesOpenChange: (open: boolean) => void;
  onSelectionChange: (selection: NormalizedSelection | null) => void;
  onShapeChange: (shape: SelectionShape) => void;
}>;

function drawSelection(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  selection: NormalizedSelection,
  shape: SelectionShape
): void {
  const left = selection.x1 * canvas.width;
  const top = selection.y1 * canvas.height;
  const width = (selection.x2 - selection.x1) * canvas.width;
  const height = (selection.y2 - selection.y1) * canvas.height;
  context.save();
  context.lineWidth = Math.max(2, canvas.width / 500);
  context.strokeStyle = "#7c5cff";
  context.fillStyle = "rgba(124, 92, 255, 0.15)";
  context.setLineDash([10, 6]);
  context.beginPath();
  if (shape === "circle") context.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  else context.rect(left, top, width, height);
  context.fill();
  context.stroke();
  context.restore();
}

export function ImageWorkspace({
  image,
  selection,
  shape,
  disabled,
  coordinatesOpen,
  onCoordinatesOpenChange,
  onSelectionChange,
  onShapeChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startRef = useRef<Point | null>(null);
  const x1Ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<NormalizedSelection | null>(null);
  const [coordinates, setCoordinates] = useState({ x1: 10, y1: 10, x2: 90, y2: 90 });
  const visibleSelection = draft ?? selection;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    if (!image) {
      canvas.width = 1;
      canvas.height = 1;
      context.clearRect(0, 0, 1, 1);
      return;
    }
    const scale = Math.min(1, 1200 / image.bitmap.width, 1200 / image.bitmap.height);
    const width = Math.max(1, Math.round(image.bitmap.width * scale));
    const height = Math.max(1, Math.round(image.bitmap.height * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image.bitmap, 0, 0, width, height);
    if (visibleSelection) drawSelection(context, canvas, visibleSelection, shape);
  }, [image, shape, visibleSelection]);

  useEffect(() => {
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

  const point = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    return canvasPointFromClient(event.clientX, event.clientY, canvas.getBoundingClientRect(), canvas);
  };

  const updateDraft = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = startRef.current;
    if (!start) return;
    const canvas = event.currentTarget;
    setDraft(normalizedSelection(start, point(event), shape, canvas));
  };

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const start = startRef.current;
    if (!start) return;
    const next = normalizedSelection(start, point(event), shape, event.currentTarget);
    startRef.current = null;
    setDraft(null);
    onSelectionChange(isUsableSelection(next) ? next : null);
  };

  const updateCoordinate = (key: keyof NormalizedSelection, value: string | number) => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return;
    setCoordinates((current) => ({ ...current, [key]: Math.max(0, Math.min(100, numeric)) }));
  };

  const applyCoordinates = () => {
    const next = {
      x1: Math.min(coordinates.x1, coordinates.x2) / 100,
      y1: Math.min(coordinates.y1, coordinates.y2) / 100,
      x2: Math.max(coordinates.x1, coordinates.x2) / 100,
      y2: Math.max(coordinates.y1, coordinates.y2) / 100,
    };
    onSelectionChange(isUsableSelection(next) ? next : null);
  };

  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <Box>
            <Title order={2} size="h3">Image workspace</Title>
            <Text size="sm" c="dimmed">
              {image
                ? `${image.descriptor.name} · ${image.bitmap.width} × ${image.bitmap.height} · ${formatBytes(image.file.size)}`
                : "Choose a JPEG, PNG, or WebP image. Processing stays in this browser."}
            </Text>
          </Box>
          <SegmentedControl
            aria-label="Selection shape"
            value={shape}
            disabled={disabled}
            onChange={(value) => onShapeChange(value as SelectionShape)}
            data={[
              { label: "Rectangle", value: "rect" },
              { label: "Circle", value: "circle" },
            ]}
          />
        </Group>

        <Box className="image-canvas-shell" data-empty={!image}>
          <canvas
            ref={canvasRef}
            className="image-canvas"
            aria-label="Image selection workspace"
            tabIndex={image ? 0 : -1}
            onPointerDown={(event) => {
              if (!image || disabled) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              startRef.current = point(event);
              setDraft(null);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) updateDraft(event);
            }}
            onPointerUp={finish}
            onPointerCancel={() => {
              startRef.current = null;
              setDraft(null);
            }}
          />
          {!image && (
            <Stack className="image-placeholder" gap={4} align="center">
              <Text fw={600}>No image loaded</Text>
              <Text size="sm" c="dimmed">Use the image drop zone above.</Text>
            </Stack>
          )}
        </Box>

        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Drag over one visible subject. Circle mode preserves square normalized bounds.
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

        <Collapse in={coordinatesOpen}>
          <Paper withBorder p="sm" radius="md">
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              {(["x1", "y1", "x2", "y2"] as const).map((key) => (
                <NumberInput
                  key={key}
                  ref={key === "x1" ? x1Ref : undefined}
                  label={`${key.toUpperCase()} %`}
                  value={coordinates[key]}
                  min={0}
                  max={100}
                  step={0.1}
                  decimalScale={1}
                  disabled={!image || disabled}
                  onChange={(value) => updateCoordinate(key, value)}
                />
              ))}
            </SimpleGrid>
            <Group justify="flex-end" mt="sm">
              <Button size="sm" disabled={!image || disabled} onClick={applyCoordinates}>Apply selection</Button>
            </Group>
          </Paper>
        </Collapse>
      </Stack>
    </Paper>
  );
}
