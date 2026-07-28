import { Box, Paper, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from "@mantine/core";
import { useEffect, useRef } from "react";
import type { LatestResult, LoadedImage } from "./app.machine";
import { formatBytes, formatDuration, formatPercent } from "./format";
import { sourceCropToPreviewPixels } from "./image-preview";

type Props = Readonly<{ result: LatestResult | null; image: LoadedImage | null }>;

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

export function ResultPanel({ result, image }: Props) {
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !result || !image) return;
    const [left, top, right, bottom] = sourceCropToPreviewPixels(
      result.crop.cropPixels,
      image.descriptor.width,
      image.descriptor.height,
      image.previewBitmap.width,
      image.previewBitmap.height
    );
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    const scale = Math.min(1, 640 / width, 360 / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    context?.drawImage(
      image.previewBitmap,
      left,
      top,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height
    );
  }, [image, result]);

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      h="100%"
    >
      <Stack gap="md">
        <Title
          order={2}
          size="h3"
        >
          Result
        </Title>
        {!result ? (
          <Stack
            align="center"
            justify="center"
            className="result-empty"
            gap="xs"
          >
            <ThemeIcon
              size="xl"
              radius="xl"
              variant="light"
            >
              ?
            </ThemeIcon>
            <Text fw={600}>No classification yet</Text>
            <Text
              size="sm"
              c="dimmed"
              ta="center"
            >
              Load the model, choose an image, and select one subject.
            </Text>
          </Stack>
        ) : (
          <Stack gap="md">
            <Box>
              <Text
                size="xs"
                c="dimmed"
                tt="uppercase"
                fw={700}
              >
                Detected subject
              </Text>
              <Title order={3}>{result.label}</Title>
            </Box>
            <canvas
              ref={previewRef}
              className="crop-preview"
              aria-label="Selected crop preview"
            />
            <SimpleGrid cols={2}>
              <Metric
                label="Token probability"
                value={formatPercent(result.tokenProbability)}
              />
              <Metric
                label="Round trip"
                value={formatDuration(result.browser.roundTripMs)}
              />
              <Metric
                label="WebGPU inference"
                value={formatDuration(result.performance.webgpuInferenceMs)}
              />
              <Metric
                label="Encoded crop"
                value={formatBytes(result.performance.encodedJpegBytes)}
              />
            </SimpleGrid>
            <Table.ScrollContainer minWidth={420}>
              <Table
                striped
                withTableBorder
              >
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Th>Source size</Table.Th>
                    <Table.Td>{result.crop.sourceSize.join(" × ")}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Crop pixels</Table.Th>
                    <Table.Td>{result.crop.cropPixels.join(", ")}</Table.Td>
                  </Table.Tr>
                  <Table.Tr>
                    <Table.Th>Model image</Table.Th>
                    <Table.Td>{result.crop.modelImageSize.join(" × ")}</Table.Td>
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
            </Table.ScrollContainer>
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
