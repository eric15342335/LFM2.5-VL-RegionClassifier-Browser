import {
  Alert,
  AppShell,
  Badge,
  Box,
  Button,
  Container,
  Grid,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { notifications } from "@mantine/notifications";
import { useMachine } from "@xstate/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { INFERENCE_CONFIG } from "../config";
import { estimateDownloadProgress } from "../download-progress";
import { BrowserInferenceClient, type InferenceClientPort } from "../inference/client";
import { appMachine, primaryActionFor } from "./app.machine";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { formatBytes, formatDuration, formatModelSize } from "./format";
import { ImageWorkspace } from "./ImageWorkspace";
import { ResultPanel } from "./ResultPanel";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function RuntimeBadge({ supported, ready, loading }: Readonly<{ supported: boolean; ready: boolean; loading: boolean }>) {
  if (!supported) return <Badge color="red" variant="light">WebGPU unavailable</Badge>;
  if (loading) return <Badge variant="light">Model loading</Badge>;
  if (ready) return <Badge color="green" variant="light">Model ready</Badge>;
  return <Badge variant="outline">WebGPU ready</Badge>;
}

export function App({ inferenceClient }: Readonly<{ inferenceClient?: InferenceClientPort }>) {
  const [client] = useState(() => inferenceClient ?? new BrowserInferenceClient(INFERENCE_CONFIG));
  const [snapshot, send] = useMachine(appMachine, { input: { client } });
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastErrorRef = useRef<string | null>(null);
  const context = snapshot.context;
  const modelSize = formatModelSize(INFERENCE_CONFIG.model.estimated_download_bytes);
  const action = primaryActionFor(snapshot, modelSize);
  const busy = snapshot.hasTag("modelLoading") || snapshot.hasTag("imageLoading") || snapshot.hasTag("classifying");
  const supported = context.capability?.supported ?? !snapshot.hasTag("unsupported");

  useEffect(() => () => void client.dispose(), [client]);

  useEffect(() => {
    if (context.operationStartedAt === null) {
      setElapsed(context.elapsedMs);
      return;
    }
    const update = () => setElapsed(performance.now() - (context.operationStartedAt ?? performance.now()));
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [context.elapsedMs, context.operationStartedAt]);

  useEffect(() => {
    if (!context.technicalError || context.technicalError === lastErrorRef.current) return;
    lastErrorRef.current = context.technicalError;
    notifications.show({
      title: "Operation failed",
      message: context.message,
      color: "red",
      autoClose: 7000,
    });
  }, [context.message, context.technicalError]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && snapshot.hasTag("classifying")) send({ type: "CANCEL" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send, snapshot]);

  const downloadProgress = useMemo(() => {
    const detail = context.progress?.detail;
    if (!detail) return null;
    const downloaded = Number(detail.downloaded_bytes);
    const predicted = Number(detail.predicted_bytes);
    if (!Number.isFinite(downloaded) || !Number.isFinite(predicted)) return null;
    return estimateDownloadProgress(downloaded, predicted, context.progress?.elapsedMs ?? elapsed);
  }, [context.progress, elapsed]);

  const acceptFile = (file: File) => send({ type: "FILE_SELECTED", file });

  const runPrimaryAction = () => {
    if (action.intent === "load-model") send({ type: "LOAD_MODEL" });
    if (action.intent === "choose-image") fileInputRef.current?.click();
    if (action.intent === "focus-selection") setCoordinatesOpen(true);
    if (action.intent === "classify") send({ type: "CLASSIFY" });
  };

  return (
    <AppShell header={{ height: 68 }} padding="md">
      <AppShell.Header>
        <Container size="xl" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap">
              <ThemeIcon size="lg" radius="md" variant="gradient">AI</ThemeIcon>
              <Box>
                <Title order={1} size="h3">Region classifier</Title>
                <Text size="xs" c="dimmed">LFM2.5-VL · local browser inference</Text>
              </Box>
            </Group>
            <RuntimeBadge supported={supported} ready={snapshot.hasTag("modelReady")} loading={snapshot.hasTag("modelLoading")} />
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="xl">
          <Stack gap="md">
            <Paper withBorder radius="lg" p="md">
              <Grid align="center">
                <Grid.Col span={{ base: 12, md: 7 }}>
                  <Dropzone
                    onDrop={(files) => files[0] && acceptFile(files[0])}
                    onReject={() => notifications.show({ title: "Image rejected", message: "Use a static JPEG, PNG, or WebP within the configured size limit.", color: "red" })}
                    accept={ACCEPTED_IMAGE_TYPES}
                    maxSize={INFERENCE_CONFIG.maxImageBytes}
                    multiple={false}
                    disabled={busy}
                    p="md"
                  >
                    <Group justify="space-between" wrap="nowrap">
                      <Box>
                        <Text fw={700}>Drop an image here</Text>
                        <Text size="sm" c="dimmed">JPEG, PNG, or WebP · up to {formatBytes(INFERENCE_CONFIG.maxImageBytes)}</Text>
                      </Box>
                      <Button variant="light" disabled={busy} onClick={(event) => { event.stopPropagation(); fileInputRef.current?.click(); }}>Browse</Button>
                    </Group>
                  </Dropzone>
                  <input
                    ref={fileInputRef}
                    hidden
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES.join(",")}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) acceptFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 5 }}>
                  <Stack gap="xs">
                    <Group justify="space-between"><Text size="sm" fw={600}>Current operation</Text><Text size="sm" c="dimmed">{formatDuration(elapsed)}</Text></Group>
                    <Progress value={context.progress?.progress ?? (busy ? 10 : 0)} aria-label="Operation progress" />
                    <Text size="sm" c="dimmed">{context.message}</Text>
                    {downloadProgress && (
                      <Text size="xs" c="dimmed">
                        {formatBytes(downloadProgress.downloadedBytes)} / {formatBytes(downloadProgress.predictedBytes)} · {downloadProgress.percentage.toFixed(1)}%
                      </Text>
                    )}
                    <Group grow>
                      <Button onClick={runPrimaryAction} disabled={!action.enabled}>{action.label}</Button>
                      <Button variant="default" onClick={() => send({ type: "CANCEL" })} disabled={!snapshot.hasTag("classifying")}>Cancel</Button>
                    </Group>
                  </Stack>
                </Grid.Col>
              </Grid>
            </Paper>

            <div role="status" aria-live="polite" className="visually-hidden">{context.message}</div>

            {snapshot.hasTag("unsupported") && (
              <Alert color="red" title="Browser inference unavailable">
                {context.technicalError ?? "Use a secure-context browser with WebGPU support."}
                <Button mt="sm" size="xs" variant="light" onClick={() => send({ type: "RETRY_PROBE" })}>Retry capability check</Button>
              </Alert>
            )}

            <Grid align="stretch">
              <Grid.Col span={{ base: 12, lg: 8 }}>
                <ImageWorkspace
                  image={context.image}
                  selection={context.selection}
                  shape={context.shape}
                  disabled={busy}
                  coordinatesOpen={coordinatesOpen}
                  onCoordinatesOpenChange={setCoordinatesOpen}
                  onSelectionChange={(selection) => send({ type: "SELECTION_CHANGED", selection })}
                  onShapeChange={(shape) => send({ type: "SHAPE_CHANGED", shape })}
                />
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 4 }}>
                <ResultPanel result={context.result} image={context.image} />
              </Grid.Col>
            </Grid>

            <DiagnosticsPanel
              capability={context.capability}
              events={context.events}
              result={context.result}
              technicalError={context.technicalError}
              onClearEvents={() => send({ type: "CLEAR_EVENTS" })}
            />
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
