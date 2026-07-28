import { Paper, Table, Text, Title } from "@mantine/core";
import "@mantine/core/styles/Table.layer.css";
import { useEffect, useRef } from "react";
import type { LatestResult, LoadedImage } from "./app.machine";
import { formatBytes, formatDuration, formatPercent } from "./format";
import { sourceCropToPreviewPixels } from "./image-preview";

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <Paper
      withBorder
      p="sm"
      radius="md"
    >
      <Text
        size="xs"
        c="dimmed"
        tt="uppercase"
        fw={700}
      >
        {label}
      </Text>
      <Text fw={700}>{value}</Text>
    </Paper>
  );
}

export function ResultDetails({
  result,
  image,
}: Readonly<{ result: LatestResult; image: LoadedImage | null }>) {
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = previewRef.current;

    if (!canvas || !image) return;
    const [left, top, right, bottom] = sourceCropToPreviewPixels(
      result.crop.cropPixels,
      image.descriptor.width,
      image.descriptor.height,
      image.previewBitmap.width,
      image.previewBitmap.height
    );
    const width = Math.max(1, right - left),
      height = Math.max(1, bottom - top),
      scale = Math.min(1, 640 / width, 360 / height);

    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas
      .getContext("2d")
      ?.drawImage(image.previewBitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
  }, [image, result]);

  return (
    <>
      <div>
        <Text
          size="xs"
          c="dimmed"
          tt="uppercase"
          fw={700}
        >
          Detected subject
        </Text>
        <Title order={3}>{result.label}</Title>
      </div>
      <canvas
        ref={previewRef}
        className="crop-preview"
        aria-label="Selected crop preview"
      />
      <div className="result-metrics">
        <Metric
          label="Token probability"
          value={formatPercent(result.tokenProbability)}
        />
        <Metric
          label="Round trip"
          value={formatDuration(result.browser.roundTripMs)}
        />
        <Metric
          label="Inference"
          value={formatDuration(result.performance.inferenceMs)}
        />
        <Metric
          label="Encoded crop"
          value={formatBytes(result.performance.encodedJpegBytes)}
        />
      </div>
      <Table
        striped
        withTableBorder
      >
        <Table.Tbody>
          <Table.Tr>
            <Table.Th>Source size</Table.Th>
            <Table.Td>{result.crop.sourceSize.join(" x ")}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Th>Crop pixels</Table.Th>
            <Table.Td>{result.crop.cropPixels.join(", ")}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Th>Model image</Table.Th>
            <Table.Td>{result.crop.modelImageSize.join(" x ")}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Th>Selected source area</Table.Th>
            <Table.Td>{formatPercent(result.crop.selectedFractionOfSource)}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Th>Finish reason</Table.Th>
            <Table.Td>{result.generation.finishReason ?? "—"}</Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </>
  );
}
