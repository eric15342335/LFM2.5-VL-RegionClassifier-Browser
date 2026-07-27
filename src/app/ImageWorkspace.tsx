import {
  Box,
  Button,
  Collapse,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import {
  isUsableSelection,
  normalizedToPercentCrop,
  percentCropToNormalized,
} from "../selection-geometry";
import type { NormalizedSelection } from "../types";
import type { LoadedImage } from "./app.machine";
import { formatBytes } from "./format";

type Props = Readonly<{
  image: LoadedImage | null;
  selection: NormalizedSelection | null;
  disabled: boolean;
  coordinatesOpen: boolean;
  onCoordinatesOpenChange: (open: boolean) => void;
  onSelectionChange: (selection: NormalizedSelection | null) => void;
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
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const x1Ref = useRef<HTMLInputElement>(null);
  const [transientCrop, setTransientCrop] = useState<PercentCrop | undefined>();
  const [coordinates, setCoordinates] = useState({ x1: 10, y1: 10, x2: 90, y2: 90 });
  const crop = transientCrop ?? (selection ? normalizedToPercentCrop(selection) : undefined);

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
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image.bitmap, 0, 0, width, height);
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
    if (isUsableSelection(next) && !selectionsEqual(next, selection)) onSelectionChange(next);
  };

  const commitCrop = (percentCrop: PercentCrop) => {
    const next = percentCropToNormalized(percentCrop);
    setTransientCrop(undefined);

    if (isUsableSelection(next)) {
      if (!selectionsEqual(next, selection)) onSelectionChange(next);
    } else if (selection !== null) onSelectionChange(null);
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

    onSelectionChange(isUsableSelection(next) ? next : null);
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
            {image
              ? `${image.descriptor.name} · ${image.bitmap.width} × ${image.bitmap.height} · ${formatBytes(image.file.size)}`
              : "Choose a JPEG, PNG, or WebP image. Processing stays in this browser."}
          </Text>
        </Box>

        <Box
          className="image-canvas-shell"
          data-empty={!image}
        >
          {image && (
            <ReactCrop
              crop={crop}
              disabled={disabled}
              keepSelection
              minWidth={10}
              minHeight={10}
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
            >
              <canvas
                ref={canvasRef}
                className="image-canvas"
                aria-label="Image selection workspace"
              />
            </ReactCrop>
          )}
          {!image && (
            <Stack
              className="image-placeholder"
              gap={4}
              align="center"
            >
              <Text fw={600}>No image loaded</Text>
              <Text
                size="sm"
                c="dimmed"
              >
                Use the image drop zone above.
              </Text>
            </Stack>
          )}
        </Box>

        <Group justify="space-between">
          <Text
            size="sm"
            c="dimmed"
          >
            Draw, move, or resize one rectangular region. Clicking outside keeps it selected.
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
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              {(["x1", "y1", "x2", "y2"] as const).map((key) => (
                <NumberInput
                  key={key}
                  ref={key === "x1" ? x1Ref : undefined}
                  label={`${key.toUpperCase()} %`}
                  value={coordinates[key]}
                  min={0}
                  max={100}
                  step={0.01}
                  decimalScale={4}
                  disabled={!image || disabled}
                  onChange={(value) => updateCoordinate(key, value)}
                />
              ))}
            </SimpleGrid>
            <Group
              justify="flex-end"
              mt="sm"
            >
              <Button
                size="sm"
                disabled={!image || disabled}
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
