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
import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { INFERENCE_CONFIG } from "../config";
import { SUPPORTED_IMAGE_FORMATS_LABEL } from "../image-format";
import { BrowserInferenceClient, type InferenceClientPort } from "../inference/client";
import { appMachine, primaryActionFor, type ImageDecoder } from "./app.machine";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { formatBytes, formatDuration, formatModelSize } from "./format";
import { closeImageBitmap } from "./image-preview";
import { EmptyImageWorkspace, ImageFilePicker } from "./ImageFilePicker";
import { ImageWorkspace } from "./ImageWorkspace";
import { ModelExecutionSelects } from "./ModelExecutionSelects";
import { ResultPanel } from "./ResultPanel";

type AppNotice = Readonly<{ title: string; message: string }>;

function RuntimeBadge({
  supported,
  ready,
  loading,
}: Readonly<{ supported: boolean; ready: boolean; loading: boolean }>) {
  if (!supported)
    return (
      <Badge
        color="red"
        variant="light"
      >
        WebGPU unavailable
      </Badge>
    );
  if (loading) return <Badge variant="light">Model loading</Badge>;
  if (ready)
    return (
      <Badge
        color="green"
        variant="light"
      >
        Model ready
      </Badge>
    );

  return <Badge variant="outline">WebGPU ready</Badge>;
}

export function App({
  inferenceClient,
  decodeImage,
}: Readonly<{ inferenceClient?: InferenceClientPort; decodeImage?: ImageDecoder }>) {
  const [client] = useState(() => inferenceClient ?? new BrowserInferenceClient(INFERENCE_CONFIG));
  const [snapshot, send] = useMachine(appMachine, { input: { client, decodeImage } });
  const [coordinatesOpen, setCoordinatesOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const dropzoneOpenRef = useRef<(() => void) | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const context = snapshot.context;
  const downloadBytes = context.capability?.storage?.download;
  const modelSize = downloadBytes === undefined ? undefined : formatModelSize(downloadBytes);
  const action = primaryActionFor(snapshot, modelSize);
  const busy =
    snapshot.hasTag("modelLoading") ||
    snapshot.hasTag("imageLoading") ||
    snapshot.hasTag("classifying");
  const supported = context.capability?.supported ?? !snapshot.hasTag("unsupported");
  const unsupported = snapshot.hasTag("unsupported");
  const showNotice = useCallback((title: string, message: string) => {
    setNotice({ title, message });
  }, []);

  useEffect(() => () => void client.dispose(), [client]);

  useEffect(() => {
    const previewBitmap = context.image?.previewBitmap;

    return () => closeImageBitmap(previewBitmap);
  }, [context.image?.previewBitmap]);

  useEffect(() => {
    if (context.operationStartedAt === null) {
      setElapsed(context.elapsedMs);

      return;
    }
    const update = () =>
      setElapsed(performance.now() - (context.operationStartedAt ?? performance.now()));

    update();
    const interval = window.setInterval(update, 50);

    return () => window.clearInterval(interval);
  }, [context.elapsedMs, context.operationStartedAt]);

  useEffect(() => {
    if (!context.technicalError) {
      lastErrorRef.current = null;

      return;
    }
    if (unsupported) {
      lastErrorRef.current = context.technicalError;

      return;
    }
    if (context.technicalError === lastErrorRef.current) return;

    lastErrorRef.current = context.technicalError;
    showNotice("Operation failed", context.message);
  }, [context.message, context.technicalError, showNotice, unsupported]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 7000);

    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && snapshot.hasTag("classifying")) send({ type: "CANCEL" });
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [send, snapshot]);

  const acceptFile = (file: File) => send({ type: "FILE_SELECTED", file });
  const rejectFile = () =>
    showNotice(
      "Image rejected",
      "Use a static JPEG, PNG, or WebP within the configured size limit."
    );
  const runPrimaryAction = () => {
    if (action.intent === "load-model") send({ type: "LOAD_MODEL" });
    if (action.intent === "choose-image") dropzoneOpenRef.current?.();
    if (action.intent === "focus-selection") setCoordinatesOpen(true);
    if (action.intent === "classify") send({ type: "CLASSIFY" });
  };

  return (
    <AppShell
      header={{ height: 68 }}
      padding="sm"
    >
      <AppShell.Header>
        <Container
          size="xl"
          h="100%"
        >
          <Group
            h="100%"
            justify="space-between"
            wrap="nowrap"
          >
            <Group
              gap="sm"
              wrap="nowrap"
            >
              <ThemeIcon
                size="lg"
                radius="md"
                variant="gradient"
              >
                <img
                  src="/logo.svg"
                  alt=""
                  width={24}
                  height={24}
                />
              </ThemeIcon>
              <Box>
                <Title
                  order={1}
                  size="h3"
                >
                  Region classifier
                </Title>
                <Text
                  size="xs"
                  c="dimmed"
                >
                  LFM2.5-VL · local browser inference
                </Text>
              </Box>
            </Group>
            <RuntimeBadge
              supported={supported}
              ready={snapshot.hasTag("modelReady")}
              loading={snapshot.hasTag("modelLoading")}
            />
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="xl">
          <Stack gap="md">
            <Paper
              withBorder
              radius="lg"
              p="md"
            >
              {context.capability?.supported ? (
                <ModelExecutionSelects
                  manifest={INFERENCE_CONFIG.model}
                  capability={context.capability}
                  profile={context.executionProfile}
                  disabled={busy}
                  onChange={(profile) =>
                    send({ type: "EXECUTION_PROFILE_CHANGED", profile })
                  }
                />
              ) : null}
              <Grid
                align="center"
                mt={context.capability?.supported ? "md" : undefined}
              >
                <Grid.Col span={{ base: 12, md: 7 }}>
                  <ImageFilePicker
                    openRef={dropzoneOpenRef}
                    onAccept={acceptFile}
                    onReject={rejectFile}
                    maxSize={INFERENCE_CONFIG.maxImageBytes}
                    disabled={busy}
                  >
                    <Group
                      justify="space-between"
                      wrap="nowrap"
                    >
                      <Box>
                        <Text fw={700}>Drop an image here</Text>
                        <Text
                          size="sm"
                          c="dimmed"
                        >
                          {SUPPORTED_IMAGE_FORMATS_LABEL} · up to{" "}
                          {formatBytes(INFERENCE_CONFIG.maxImageBytes)}
                        </Text>
                      </Box>
                    </Group>
                  </ImageFilePicker>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 5 }}>
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text
                        size="sm"
                        fw={600}
                      >
                        Status
                      </Text>
                      {busy && (
                        <Text
                          size="sm"
                          c="dimmed"
                        >
                          {formatDuration(elapsed)}
                        </Text>
                      )}
                    </Group>
                    <Progress
                      value={context.progress?.progress ?? (busy ? 10 : 0)}
                      aria-label="Operation progress"
                    />
                    <Text
                      size="sm"
                      c="dimmed"
                    >
                      {context.message}
                    </Text>
                    <Group grow>
                      <Button
                        onClick={runPrimaryAction}
                        disabled={!action.enabled}
                      >
                        {action.label}
                      </Button>
                      <Button
                        variant="default"
                        onClick={() => send({ type: "CANCEL" })}
                        disabled={!snapshot.hasTag("classifying")}
                      >
                        Cancel
                      </Button>
                    </Group>
                  </Stack>
                </Grid.Col>
              </Grid>
            </Paper>

            <div
              role="status"
              aria-live="polite"
              className="visually-hidden"
            >
              {context.message}
            </div>

            <Grid
              className="main-workspace-grid"
              align="stretch"
            >
              <Grid.Col span={{ base: 12, lg: 8 }}>
                {context.image ? (
                  <ImageWorkspace
                    image={context.image}
                    selection={context.selection}
                    disabled={busy}
                    coordinatesOpen={coordinatesOpen}
                    onCoordinatesOpenChange={setCoordinatesOpen}
                    onSelectionChange={(selection) =>
                      send({ type: "SELECTION_CHANGED", selection })
                    }
                    onSelectionComplete={(selection) =>
                      send({ type: "SELECTION_COMPLETED", selection })
                    }
                  />
                ) : (
                  <EmptyImageWorkspace />
                )}
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 4 }}>
                <ResultPanel
                  result={context.result}
                  image={context.image}
                />
              </Grid.Col>
            </Grid>

            <DiagnosticsPanel
              capability={context.capability}
              events={context.events}
              result={context.result}
              technicalError={context.technicalError}
              onClearEvents={() => send({ type: "CLEAR_EVENTS" })}
            />

            {unsupported && (
              <Alert
                color="red"
                title="Browser inference unavailable"
              >
                {context.technicalError ?? "Use a secure-context browser with WebGPU support."}
                <Button
                  mt="sm"
                  size="xs"
                  variant="light"
                  onClick={() => send({ type: "RETRY_PROBE" })}
                >
                  Try again
                </Button>
              </Alert>
            )}
          </Stack>
        </Container>
      </AppShell.Main>
      <div
        className="notice-region"
        aria-live="assertive"
        aria-atomic="true"
      >
        {notice && (
          <div
            className="app-notice"
            role="alert"
          >
            <div>
              <Text fw={700}>{notice.title}</Text>
              <Text size="sm">{notice.message}</Text>
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
