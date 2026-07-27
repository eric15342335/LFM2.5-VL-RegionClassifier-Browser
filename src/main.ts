import "./styles/app.css";
import "./styles/ui-overrides.css";
import { INFERENCE_CONFIG } from "./config";
import { estimateDownloadProgress } from "./download-progress";
import { BrowserInferenceEngine } from "./engines/browser-engine";
import {
  canvasPointFromClient,
  clamp,
  isUsableSelection,
  selectionEnd,
  normalizedSelection as toNormalizedSelection,
  type Point,
} from "./selection-geometry";
import type {
  BrowserCapability,
  ClassificationResult,
  ImageDescriptor,
  NormalizedSelection,
  ProgressEvent,
  SelectionShape,
} from "./types";
import {
  deriveUiState,
  normalizeWorkerStage,
  primaryActionFor,
  progressModeForWorkerStage,
  stagesFor,
  type Operation,
  type Outcome,
  type ProgressMode,
  type StageStatus,
} from "./ui-state";

type LatestResult = ClassificationResult & {
  browser: { round_trip_ms: number };
};
type FactEntry = readonly [name: string, value: unknown];
type ResultRow = readonly [name: string, value: unknown, raw?: boolean];
type UiSeverity = "info" | "error";

type UiModel = {
  capability: "probing" | "available" | "unavailable";
  operation: Operation;
  outcome: Outcome;
  progressMode: ProgressMode;
  stage: string | null;
  stageStatus: StageStatus;
  message: string;
  severity: UiSeverity;
  technicalError: string | null;
};

function requiredElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

const element = {
  file: requiredElement<HTMLInputElement>("file"),
  fileName: requiredElement<HTMLElement>("fileName"),
  shape: requiredElement<HTMLSelectElement>("shape"),
  browserModelStatus: requiredElement<HTMLElement>("browserModelStatus"),
  modelStorageEstimate: requiredElement<HTMLElement>("modelStorageEstimate"),
  modelDownloadProgress: requiredElement<HTMLElement>("modelDownloadProgress"),
  modelDownloadPercent: requiredElement<HTMLOutputElement>("modelDownloadPercent"),
  modelDownloadBar: requiredElement<HTMLProgressElement>("modelDownloadBar"),
  modelDownloadMeta: requiredElement<HTMLElement>("modelDownloadMeta"),
  primaryAction: requiredElement<HTMLButtonElement>("primaryAction"),
  actionHint: requiredElement<HTMLElement>("actionHint"),
  cancel: requiredElement<HTMLButtonElement>("cancel"),
  capabilityPill: requiredElement<HTMLElement>("capabilityPill"),
  capabilityText: requiredElement<HTMLElement>("capabilityText"),
  elapsed: requiredElement<HTMLOutputElement>("elapsed"),
  status: requiredElement<HTMLElement>("status"),
  statusAnnouncement: requiredElement<HTMLElement>("statusAnnouncement"),
  actionFeedback: requiredElement<HTMLElement>("actionFeedback"),
  technicalDetails: requiredElement<HTMLDetailsElement>("technicalDetails"),
  technicalError: requiredElement<HTMLElement>("technicalError"),
  resultEmpty: requiredElement<HTMLElement>("resultEmpty"),
  resultContent: requiredElement<HTMLElement>("resultContent"),
  label: requiredElement<HTMLElement>("label"),
  probability: requiredElement<HTMLElement>("probability"),
  coverage: requiredElement<HTMLElement>("coverage"),
  totalTime: requiredElement<HTMLElement>("totalTime"),
  imageDimensions: requiredElement<HTMLElement>("imageDimensions"),
  canvasShell: requiredElement<HTMLElement>("canvasShell"),
  canvas: requiredElement<HTMLCanvasElement>("canvas"),
  canvasPlaceholder: requiredElement<HTMLElement>("canvasPlaceholder"),
  selectionLegend: requiredElement<HTMLElement>("selectionLegend"),
  cropLegend: requiredElement<HTMLElement>("cropLegend"),
  coordinatePanel: requiredElement<HTMLDetailsElement>("coordinatePanel"),
  cropPreviewWrap: requiredElement<HTMLDetailsElement>("cropPreviewWrap"),
  x1: requiredElement<HTMLInputElement>("x1"),
  y1: requiredElement<HTMLInputElement>("y1"),
  x2: requiredElement<HTMLInputElement>("x2"),
  y2: requiredElement<HTMLInputElement>("y2"),
  applyCoordinates: requiredElement<HTMLButtonElement>("applyCoordinates"),
  cropDimensions: requiredElement<HTMLElement>("cropDimensions"),
  cropPreview: requiredElement<HTMLCanvasElement>("cropPreview"),
  deviceBadge: requiredElement<HTMLElement>("deviceBadge"),
  hardwareSummary: requiredElement<HTMLElement>("hardwareSummary"),
  hardwareFacts: requiredElement<HTMLDListElement>("hardwareFacts"),
  engineFacts: requiredElement<HTMLDListElement>("engineFacts"),
  eventLog: requiredElement<HTMLOListElement>("eventLog"),
  clearEvents: requiredElement<HTMLButtonElement>("clearEvents"),
  generation: requiredElement<HTMLTableSectionElement>("generation"),
  copyResult: requiredElement<HTMLButtonElement>("copyResult"),
  copyDebug: requiredElement<HTMLButtonElement>("copyDebug"),
  rawResult: requiredElement<HTMLPreElement>("rawResult"),
  rawCapability: requiredElement<HTMLPreElement>("rawCapability"),
};

function requiredCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const value = canvas.getContext("2d");
  if (!value) throw new Error("2D canvas is unavailable");
  return value;
}

const context = requiredCanvasContext(element.canvas);
const cropContext = requiredCanvasContext(element.cropPreview);
const coordinateKeys = ["x1", "y1", "x2", "y2"] as const;
const engine = new BrowserInferenceEngine(INFERENCE_CONFIG);

let bitmap: ImageBitmap | null = null;
let start: Point | null = null;
let end: Point | null = null;
let drawing = false;
let latest: LatestResult | null = null;
let capabilityData: BrowserCapability | null = null;
let controller: AbortController | null = null;
let imageController: AbortController | null = null;
let imageDescriptor: ImageDescriptor | null = null;
let imageLoadSequence = 0;
let requestSequence = 0;
let operationStarted = 0;
let timer: number | null = null;
let eventHistory: ProgressEvent[] = [];
const eventItems = new Map<string, HTMLLIElement>();
let lastAnnouncedState = "";

const ui: UiModel = {
  capability: "probing",
  operation: "idle",
  outcome: "none",
  progressMode: "idle",
  stage: null,
  stageStatus: "idle",
  message: "Checking browser support...",
  severity: "info",
  technicalError: null,
};

function currentUiState() {
  return deriveUiState({
    capability: ui.capability,
    operation: ui.operation,
    outcome: ui.outcome,
    modelPrepared: engine.isPrepared(),
    hasImage: Boolean(bitmap && imageDescriptor),
    hasSelection: hasUsableSelection(),
  });
}

function currentPrimaryAction(state = currentUiState()) {
  return primaryActionFor(
    state,
    formatDownloadBytes(INFERENCE_CONFIG.model.estimated_download_bytes),
    ui.operation === "image-loading",
    ui.capability === "available"
  );
}

function resetSelectionWorkflow(): void {
  ui.outcome = "none";
  ui.progressMode = "idle";
  ui.stage = null;
  ui.stageStatus = "idle";
}

function setText(target: Node, value: unknown): void {
  target.textContent = String(value);
}

function formatMilliseconds(value: unknown): string {
  if (!Number.isFinite(Number(value))) return "Not available";
  const milliseconds = Number(value);
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : `${milliseconds.toFixed(1)} ms`;
}

function formatBytes(value: unknown): string {
  if (!Number.isFinite(Number(value))) return "Not available";
  const bytes = Number(value);
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[unit]}`;
}

function formatDownloadBytes(value: unknown): string {
  if (!Number.isFinite(Number(value))) return "Not available";
  const megabytes = Number(value) / 1_000_000;
  return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} MB`;
}

function formatRemainingTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "Calculating remaining time…";
  if (seconds < 60) return `About ${Math.max(1, Math.ceil(seconds))} seconds remaining`;
  return `About ${Math.ceil(seconds / 60)} minutes remaining`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not available";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function errorDetails(error: unknown): string {
  if (error instanceof Error)
    return error.stack ? `${error.name}: ${error.message}\n${error.stack}` : error.message;
  return String(error);
}

function point(event: PointerEvent): Point {
  const bounds = element.canvas.getBoundingClientRect();
  return canvasPointFromClient(event.clientX, event.clientY, bounds, element.canvas);
}

function finalPoint(): Point {
  if (!start || !end) throw new Error("A selection has not been drawn");
  return selectionEnd(start, end, element.shape.value as SelectionShape);
}

function normalizedSelection(): NormalizedSelection {
  if (!start) throw new Error("A selection has not been drawn");
  if (!end) throw new Error("A selection has not been drawn");
  return toNormalizedSelection(start, end, element.shape.value as SelectionShape, element.canvas);
}

function hasUsableSelection(): boolean {
  if (!start || !end || !bitmap) return false;
  return isUsableSelection(normalizedSelection());
}

function syncCoordinateInputs(): void {
  if (!start || !end) return;
  const selection = normalizedSelection();
  for (const key of coordinateKeys) element[key].value = (selection[key] * 100).toFixed(1);
}

function classifyCompletedSelection(): void {
  if (!hasUsableSelection()) {
    ui.message = "Selection is too small. Expand it and try again.";
    ui.severity = "error";
    ui.technicalError = null;
    draw();
    renderUi();
    return;
  }
  if (!engine.isPrepared()) {
    ui.message = "Selection ready. Load the local model to classify it.";
    ui.severity = "info";
    ui.technicalError = null;
    draw();
    renderUi();
    return;
  }
  void classify();
}

function applyCoordinateInputs(): void {
  if (!bitmap) return;
  const values: NormalizedSelection = {
    x1: clamp(Number(element.x1.value) / 100, 0, 1),
    y1: clamp(Number(element.y1.value) / 100, 0, 1),
    x2: clamp(Number(element.x2.value) / 100, 0, 1),
    y2: clamp(Number(element.y2.value) / 100, 0, 1),
  };
  start = {
    x: values.x1 * element.canvas.width,
    y: values.y1 * element.canvas.height,
  };
  end = {
    x: values.x2 * element.canvas.width,
    y: values.y2 * element.canvas.height,
  };
  clearStaleResult();
  resetSelectionWorkflow();
  classifyCompletedSelection();
}

function strokeNormalizedBox(
  box: readonly number[],
  color: string,
  width: number,
  dashed = false
): void {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = box;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(dashed ? [10, 7] : []);
  context.strokeRect(
    x1 * element.canvas.width,
    y1 * element.canvas.height,
    (x2 - x1) * element.canvas.width,
    (y2 - y1) * element.canvas.height
  );
  context.restore();
}

function drawSelection(): void {
  if (!start || !end) return;
  const last = finalPoint();
  const x = Math.min(start.x, last.x);
  const y = Math.min(start.y, last.y);
  const width = Math.abs(last.x - start.x);
  const height = Math.abs(last.y - start.y);

  context.save();
  context.strokeStyle = "#fb7185";
  context.fillStyle = "rgb(251 113 133 / 10%)";
  context.lineWidth = Math.max(3, element.canvas.width / 260);
  if (element.shape.value === "circle") {
    context.beginPath();
    context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  } else {
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
  }
  context.restore();
}

function draw(): void {
  if (!bitmap) return;
  context.clearRect(0, 0, element.canvas.width, element.canvas.height);
  context.drawImage(bitmap, 0, 0, element.canvas.width, element.canvas.height);
  if (latest?.crop?.cropBox) strokeNormalizedBox(latest.crop.cropBox, "#4ade80", 3, true);
  drawSelection();
}

function drawCropPreview(result: ClassificationResult): void {
  if (!bitmap || !result.crop.cropBox) return;
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = result.crop.cropBox;
  const sourceX = x1 * bitmap.width;
  const sourceY = y1 * bitmap.height;
  const sourceWidth = Math.max(1, (x2 - x1) * bitmap.width);
  const sourceHeight = Math.max(1, (y2 - y1) * bitmap.height);
  const scale = Math.min(1, 520 / sourceWidth, 300 / sourceHeight);

  element.cropPreview.width = Math.max(1, Math.round(sourceWidth * scale));
  element.cropPreview.height = Math.max(1, Math.round(sourceHeight * scale));
  cropContext.clearRect(0, 0, element.cropPreview.width, element.cropPreview.height);
  cropContext.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    element.cropPreview.width,
    element.cropPreview.height
  );
  setText(
    element.cropDimensions,
    `${result.crop.cropSizeBeforeResize.join(" x ")} to ${result.crop.modelImageSize.join(" x ")}`
  );
  element.cropPreview.setAttribute(
    "aria-label",
    `Model crop preview, ${result.crop.cropSizeBeforeResize.join(" by ")} resized to ${result.crop.modelImageSize.join(" by ")}`
  );
}

function clearTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  operationStarted = 0;
  setText(element.elapsed, "0 ms");
}

function startTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  operationStarted = performance.now();
  timer = window.setInterval(() => {
    setText(element.elapsed, formatMilliseconds(performance.now() - operationStarted));
  }, 100);
}

function elapsedTime(): number {
  return operationStarted ? performance.now() - operationStarted : 0;
}

function finishTimer(value = elapsedTime()): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  operationStarted = 0;
  setText(element.elapsed, formatMilliseconds(value));
}

function updateProgress(event: ProgressEvent): void {
  let mode = progressModeForWorkerStage(event.stage);
  let stage: string | null;
  if (event.stage === "recovery") {
    mode = "model";
    stage = "probe";
  } else {
    stage = normalizeWorkerStage(mode, event.stage);
  }
  if (mode === "idle" || !stage) return;

  ui.progressMode = mode;
  ui.stage = stage;
  ui.stageStatus = "active";
  ui.message = event.message;
  ui.severity = "info";
  if (mode === "model" && stage === "download") updateModelDownloadProgress(event);
  renderUi();
}

function resetModelDownloadProgress(): void {
  element.modelDownloadBar.value = 0;
  setText(element.modelDownloadPercent, "0%");
  setText(
    element.modelDownloadMeta,
    `0 MB of ${formatDownloadBytes(INFERENCE_CONFIG.model.estimated_download_bytes)} · Preparing download…`
  );
}

function updateModelDownloadProgress(event: ProgressEvent): void {
  const downloadedBytes = Number(event.detail?.downloaded_bytes);
  const predictedBytes = Number(event.detail?.predicted_bytes);
  if (!Number.isFinite(downloadedBytes) || !Number.isFinite(predictedBytes)) return;
  const progress = estimateDownloadProgress(downloadedBytes, predictedBytes, event.elapsedMs);
  element.modelDownloadBar.value = progress.percentage;
  setText(element.modelDownloadPercent, `${Math.floor(progress.percentage)}%`);
  setText(
    element.modelDownloadMeta,
    `${formatDownloadBytes(progress.downloadedBytes)} of ${formatDownloadBytes(progress.predictedBytes)} · ${formatRemainingTime(progress.remainingSeconds)}`
  );
}

function appendFact(fragment: DocumentFragment, name: string, value: unknown): void {
  if (value === null || value === undefined || value === "") return;
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  setText(term, name);
  setText(description, formatValue(value));
  wrapper.append(term, description);
  fragment.append(wrapper);
}

function renderFacts(target: HTMLElement, entries: readonly FactEntry[]): void {
  const fragment = document.createDocumentFragment();
  for (const [name, value] of entries) appendFact(fragment, name, value);
  target.replaceChildren(fragment);
}

function renderBrowserCapability(capability: BrowserCapability): void {
  const adapter = capability.adapterInfo ?? {};
  const storage = capability.storage;
  setText(element.deviceBadge, capability.supported ? "WEBGPU" : "UNAVAILABLE");

  const adapterName = formatValue(
    adapter.description ?? adapter.device ?? adapter.architecture ?? "WebGPU adapter"
  );
  const storageSummary = storage?.quota
    ? `${formatBytes(storage.available)} storage available`
    : "Storage estimate unavailable";
  setText(
    element.hardwareSummary,
    capability.supported
      ? `${adapterName} | ${storageSummary}`
      : capability.reason || "Browser WebGPU capability check failed"
  );

  renderFacts(element.hardwareFacts, [
    ["Secure context", capability.secureContext ? "Yes" : "No"],
    ["WebGPU exposed", capability.hasWebgpu ? "Yes" : "No"],
    ["Adapter acquired", capability.adapterAcquired ? "Yes" : "No"],
    ["shader-f16", capability.shaderF16 ? "Yes" : "No"],
    ["Vendor", adapter.vendor],
    ["Architecture", adapter.architecture],
    ["Device", adapter.device],
    ["Description", adapter.description],
    ["Storage quota", storage?.quota ? formatBytes(storage.quota) : null],
    ["Storage used", storage?.usage ? formatBytes(storage.usage) : null],
    ["Model storage requirement", storage?.required ? formatBytes(storage.required) : null],
  ]);
}

function renderEngine(): void {
  const model = INFERENCE_CONFIG.model;
  renderFacts(element.engineFacts, [
    ["Engine", engine.name],
    ["Model", model.repository],
    ["Revision", model.revision],
    ["Runtime", model.runtime],
    ["Transformers.js", model.transformers_js_version],
    ["Image tokens", INFERENCE_CONFIG.imageTokens],
    ["Image side", INFERENCE_CONFIG.imageSide],
    ["Resampling", INFERENCE_CONFIG.resampling],
    ["Inference timeout", `${INFERENCE_CONFIG.inferenceTimeoutSeconds} s`],
    ["Estimated download", formatDownloadBytes(model.estimated_download_bytes)],
    ["License", model.license],
  ]);
}

function renderRows(entries: readonly ResultRow[]): void {
  const fragment = document.createDocumentFragment();
  for (const [name, value, raw = false] of entries) {
    const row = document.createElement("tr");
    const key = document.createElement("th");
    const cell = document.createElement("td");
    key.scope = "row";
    setText(key, name);
    setText(
      cell,
      typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "Not available")
    );
    if (raw) cell.className = "raw-cell";
    row.append(key, cell);
    fragment.append(row);
  }
  element.generation.replaceChildren(fragment);
}

function renderJson(target: HTMLElement, value: unknown): void {
  const code = document.createElement("code");
  if (value === null || value === undefined) {
    setText(code, "No data.");
    target.replaceChildren(code);
    return;
  }

  const json = JSON.stringify(value, null, 2);
  const tokenPattern = /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi;
  let cursor = 0;
  for (const match of json.matchAll(tokenPattern)) {
    code.append(document.createTextNode(json.slice(cursor, match.index)));
    const token = match[0];
    const span = document.createElement("span");
    if (token.startsWith('"')) {
      const remainder = json.slice(match.index + token.length);
      span.className = /^\s*:/.test(remainder) ? "json-key" : "json-string";
    } else if (token === "null") {
      span.className = "json-null";
    } else if (token === "true" || token === "false") {
      span.className = "json-boolean";
    } else {
      span.className = "json-number";
    }
    setText(span, token);
    code.append(span);
    cursor = match.index + token.length;
  }
  code.append(document.createTextNode(json.slice(cursor)));
  target.replaceChildren(code);
}

function renderResult(result: ClassificationResult, roundTrip: number): void {
  latest = {
    ...result,
    browser: { round_trip_ms: Number(roundTrip.toFixed(3)) },
  };
  const probability = result.tokenProbability;
  setText(element.label, result.label);
  setText(
    element.probability,
    probability === null || probability === undefined
      ? "Not returned"
      : `${(Number(probability) * 100).toFixed(1)}%`
  );
  setText(element.coverage, `${(Number(result.crop.selectedFractionOfCrop) * 100).toFixed(1)}%`);
  setText(element.totalTime, formatMilliseconds(result.performance.totalMs));
  renderRows([
    ["Cleaned label", result.label],
    ["Raw output", result.generation.rawOutput, true],
    ["Finish reason", result.generation.finishReason],
    ["Token confidence", result.tokenProbability],
    ["Usage", result.generation.usage, true],
    ["Token logprobs", result.generation.tokenLogprobs, true],
    ["Engine timings", result.generation.engineTimings, true],
    ["Selection box", result.selection.box, true],
    ["Crop box", result.crop.cropBox, true],
    ["Execution", result.runtime.executionLocation, true],
    ["Image ID", result.imageId, true],
    ["Request ID", result.requestId, true],
  ]);
  renderJson(element.rawResult, latest);
  drawCropPreview(result);
  draw();
  element.copyResult.disabled = false;
  element.copyDebug.disabled = false;
}

function resetResultPresentation(): void {
  setText(element.label, "Not available");
  setText(element.probability, "Not available");
  setText(element.coverage, "Not available");
  setText(element.totalTime, "Not available");
  setText(element.cropDimensions, "Not available");
  element.cropPreview.width = 1;
  element.cropPreview.height = 1;
  element.cropPreviewWrap.open = false;
  cropContext.clearRect(0, 0, 1, 1);
  renderRows([["State", "No result yet."]]);
  renderJson(element.rawResult, null);
  element.copyResult.disabled = true;
  element.copyDebug.disabled = eventHistory.length === 0;
}

function clearStaleResult(): void {
  latest = null;
  resetResultPresentation();
  draw();
}

function clearEventLog(): void {
  eventHistory = [];
  eventItems.clear();
  const empty = document.createElement("li");
  empty.className = "empty-copy";
  setText(empty, "No request events yet.");
  element.eventLog.replaceChildren(empty);
  element.clearEvents.disabled = true;
  element.copyDebug.disabled = latest === null;
}

function addEvent(event: ProgressEvent): void {
  eventHistory.push(event);
  const key = event.stage || event.event;
  let item = eventItems.get(key);

  if (!item) {
    if (eventItems.size === 0) element.eventLog.replaceChildren();
    item = document.createElement("li");
    item.dataset.eventKey = key;
    eventItems.set(key, item);
    element.eventLog.append(item);
  }

  element.clearEvents.disabled = false;
  element.copyDebug.disabled = false;
  renderEventItem(item, event);
}

function renderEventItem(item: HTMLLIElement, event: ProgressEvent): void {
  const heading = document.createElement("div");
  heading.className = "event-heading";
  const stage = document.createElement("strong");
  const time = document.createElement("time");
  setText(stage, event.stage || event.event);
  setText(time, formatMilliseconds(event.elapsedMs));
  heading.append(stage, time);

  const message = document.createElement("p");
  setText(message, event.message || "");
  item.replaceChildren(heading, message);

  if (event.detail && Object.keys(event.detail).length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const code = document.createElement("code");
    setText(summary, "View metadata");
    setText(code, JSON.stringify(event.detail, null, 2));
    details.append(summary, code);
    item.append(details);
  }
}

function runtimeHint(state: ReturnType<typeof deriveUiState>): string {
  const modelSize = formatDownloadBytes(INFERENCE_CONFIG.model.estimated_download_bytes);
  switch (state) {
    case "probing":
      return "Checking whether this browser can run the model locally.";
    case "model-required":
      return `The ${modelSize} model runs locally in this browser. Images remain on this device.`;
    case "model-loading":
      return "Downloading, compiling, and warming up the local model.";
    case "image-required":
      return "Choose an image to begin.";
    case "selection-required":
      return "Draw around one object on the image, or use the coordinate controls.";
    case "ready":
      return "Review the selection, then classify it locally.";
    case "classifying":
      return "The selected crop is being classified in this browser.";
    case "success":
      return "Token confidence reflects generated-token probabilities; it is not a calibrated correctness score.";
    case "model-error":
      return ui.capability === "unavailable"
        ? "This browser cannot initialize the required local WebGPU runtime."
        : "You can retry the local model load. Technical details remain available below the status.";
    case "inference-error":
      return "Try the selection again. Technical details remain available below the status.";
    case "cancelled":
      return "The classification was cancelled. Adjust the selection or run it again.";
  }
}

function renderRuntimeStatus(state: ReturnType<typeof deriveUiState>): void {
  let pillText = "Checking WebGPU";
  let pillClass = "capability-pill";
  let modelStatus = "Checking browser capability...";
  if (ui.capability === "unavailable") {
    pillText = "WebGPU unavailable";
    pillClass += " error";
    modelStatus = "WebGPU unavailable in this browser";
  } else if (ui.capability === "available" && ui.operation === "model-loading") {
    pillText = "Model loading";
    modelStatus = "Loading in this browser";
  } else if (ui.capability === "available" && engine.isPrepared()) {
    pillText = "Model ready";
    pillClass += " ok";
    modelStatus = "Ready in this browser session";
  } else if (ui.capability === "available") {
    pillText = "WebGPU ready";
    modelStatus = "Run locally in this browser";
  }
  if (state === "model-error" && ui.capability === "available") {
    modelStatus = ui.message.startsWith("The model loaded")
      ? "Processor setup failed"
      : "Model load failed";
  }
  element.capabilityPill.className = pillClass;
  setText(element.capabilityText, pillText);
  setText(element.browserModelStatus, modelStatus);
}

function renderUi(): void {
  const state = currentUiState();
  const busy = ui.operation !== "idle";
  const action = currentPrimaryAction(state);
  setText(element.primaryAction, action.label);
  element.primaryAction.disabled = !action.enabled;
  element.cancel.hidden = false;
  element.cancel.classList.toggle("is-reserved-hidden", ui.operation !== "classifying");
  element.cancel.setAttribute("aria-hidden", String(ui.operation !== "classifying"));
  element.cancel.disabled = ui.operation !== "classifying";
  element.file.disabled = busy;
  element.shape.disabled = busy;
  element.applyCoordinates.disabled = busy || !bitmap;
  element.canvas.classList.toggle("busy", busy);

  setText(element.status, ui.message);
  element.status.classList.toggle("error", ui.severity === "error");
  const announcementKey = `${state}:${ui.severity}`;
  if (announcementKey !== lastAnnouncedState) {
    setText(element.statusAnnouncement, ui.message);
    lastAnnouncedState = announcementKey;
  }
  element.technicalDetails.hidden = !ui.technicalError;
  if (ui.technicalError) setText(element.technicalError, ui.technicalError);

  element.resultContent.hidden = latest === null;
  element.resultEmpty.hidden = latest !== null;
  const hasImage = Boolean(bitmap && imageDescriptor);
  element.selectionLegend.hidden = !hasImage;
  element.cropLegend.hidden = latest === null;
  element.coordinatePanel.hidden = !hasImage;
  element.cropPreviewWrap.hidden = latest === null;
  element.clearEvents.disabled = eventHistory.length === 0;
  element.copyDebug.disabled = latest === null && eventHistory.length === 0;
  element.modelDownloadProgress.hidden = ui.operation !== "model-loading";
  renderRuntimeStatus(state);
  setText(element.actionHint, runtimeHint(state));
}

function failOperation(
  kind: Extract<Outcome, "model-error" | "inference-error">,
  error: unknown
): void {
  const mode =
    kind === "model-error" ? "model" : ui.progressMode === "idle" ? "inference" : ui.progressMode;
  if (ui.stage === null) ui.stage = stagesFor(mode)[0]?.id ?? null;
  ui.progressMode = mode;
  ui.stageStatus = "failed";
  ui.operation = "idle";
  ui.outcome = kind;
  const processorFailure =
    error instanceof Error &&
    (error.name === "ProcessorConfigurationError" || error.name === "MultimodalInputBudgetError");
  ui.message = processorFailure
    ? "The model loaded, but the local processor could not prepare an input within its token budget."
    : kind === "model-error"
      ? "The model could not be loaded. The browser runtime could not initialize this model."
      : "The selection could not be classified. Try again.";
  ui.severity = "error";
  ui.technicalError = errorDetails(error);
  finishTimer();
  addEvent({
    event: "error",
    stage: ui.stage ?? "error",
    message: ui.message,
    elapsedMs: 0,
    progress: 0,
    detail: { error: ui.technicalError },
  });
  renderUi();
  if (kind === "model-error") window.setTimeout(() => element.primaryAction.focus(), 0);
}

function cancelClassification(): void {
  if (ui.operation !== "classifying") return;
  ui.message = "Cancelling classification...";
  ui.severity = "info";
  renderUi();
  controller?.abort();
  engine.cancel();
}

async function classify(): Promise<void> {
  if (!imageDescriptor || !hasUsableSelection()) {
    ui.message = "Draw around one object before classifying.";
    ui.severity = "error";
    renderUi();
    return;
  }
  if (!engine.isPrepared()) {
    ui.message = "Load the local model before classifying.";
    ui.severity = "error";
    renderUi();
    return;
  }

  const selection = normalizedSelection();
  requestSequence += 1;
  const currentRequest = requestSequence;
  controller?.abort();
  controller = new AbortController();
  clearStaleResult();
  clearEventLog();
  ui.operation = "classifying";
  ui.outcome = "none";
  ui.progressMode = "inference";
  ui.stage = "accepted";
  ui.stageStatus = "active";
  ui.message = "Starting local classification...";
  ui.severity = "info";
  ui.technicalError = null;
  startTimer();
  renderUi();

  try {
    const result = await engine.classify({
      imageId: imageDescriptor.id,
      region: { ...selection, shape: element.shape.value as SelectionShape },
      signal: controller.signal,
      onProgress(event) {
        if (currentRequest !== requestSequence) return;
        updateProgress(event);
        addEvent(event);
      },
    });
    if (currentRequest !== requestSequence) return;
    const roundTrip = elapsedTime();
    finishTimer(roundTrip);
    renderResult(result, roundTrip);
    ui.operation = "idle";
    ui.outcome = "success";
    ui.progressMode = "inference";
    ui.stage = "complete";
    ui.stageStatus = "active";
    ui.message = `Classification complete: ${result.label}.`;
    ui.severity = "info";
    ui.technicalError = null;
    renderUi();
  } catch (error) {
    if (currentRequest !== requestSequence) return;
    if (error instanceof Error && error.name === "AbortError") {
      ui.operation = "idle";
      ui.outcome = "cancelled";
      ui.stageStatus = "cancelled";
      ui.message = "Classification cancelled.";
      ui.severity = "info";
      ui.technicalError = null;
      finishTimer();
      renderUi();
    } else {
      failOperation("inference-error", error);
    }
  } finally {
    if (currentRequest === requestSequence) controller = null;
  }
}

async function loadModel(): Promise<void> {
  if (ui.capability !== "available" || ui.operation !== "idle") return;
  clearEventLog();
  resetModelDownloadProgress();
  ui.operation = "model-loading";
  ui.outcome = "none";
  ui.progressMode = "model";
  ui.stage = "probe";
  ui.stageStatus = "active";
  ui.message = "Checking browser capability for the local model...";
  ui.severity = "info";
  ui.technicalError = null;
  startTimer();
  renderUi();

  try {
    await engine.prepare((event) => {
      updateProgress(event);
      addEvent(event);
    });
    finishTimer();
    ui.operation = "idle";
    ui.outcome = "none";
    ui.progressMode = "model";
    ui.stage = "ready";
    ui.stageStatus = "active";
    ui.message = imageDescriptor
      ? hasUsableSelection()
        ? "Local model ready. Starting classification for the selected region."
        : "Local model ready. Draw around one object to classify it."
      : "Local model ready. Choose an image to begin.";
    ui.severity = "info";
    ui.technicalError = null;
    renderUi();
    if (hasUsableSelection()) void classify();
  } catch (error) {
    failOperation("model-error", error);
  }
}

async function initializeBrowserInference(): Promise<void> {
  renderEngine();
  renderJson(element.rawCapability, { config: INFERENCE_CONFIG });
  setText(
    element.modelStorageEstimate,
    `${formatDownloadBytes(INFERENCE_CONFIG.model.estimated_download_bytes)} compressed download; browser cache may be evicted`
  );
  renderUi();

  try {
    capabilityData = await engine.probe();
    renderBrowserCapability(capabilityData);
    renderJson(element.rawCapability, { capability: capabilityData, config: INFERENCE_CONFIG });
    if (!capabilityData.supported) {
      ui.capability = "unavailable";
      ui.outcome = "model-error";
      ui.message = "This browser cannot run the local WebGPU model.";
      ui.severity = "error";
      ui.technicalError = capabilityData.reason || "Browser WebGPU capability check failed";
    } else {
      ui.capability = "available";
      ui.outcome = "none";
      ui.message = "WebGPU is available. Load the local model to continue.";
      ui.severity = "info";
      ui.technicalError = null;
    }
  } catch (error) {
    ui.capability = "unavailable";
    ui.outcome = "model-error";
    ui.message = "This browser could not initialize local WebGPU inference.";
    ui.severity = "error";
    ui.technicalError = errorDetails(error);
    renderJson(element.rawCapability, {
      capability: capabilityData,
      error: ui.technicalError,
      config: INFERENCE_CONFIG,
    });
  }
  renderUi();
}

async function loadImage(file: File): Promise<void> {
  imageController?.abort();
  imageController = new AbortController();
  imageLoadSequence += 1;
  const currentLoad = imageLoadSequence;
  const oldImageId = imageDescriptor?.id;
  imageDescriptor = null;
  if (oldImageId) await engine.releaseImage(oldImageId);
  if (bitmap) {
    bitmap.close();
    bitmap = null;
  }

  element.canvas.width = 1;
  element.canvas.height = 1;
  element.canvasShell.classList.add("empty");
  element.canvasPlaceholder.hidden = false;
  setText(element.fileName, file.name);
  setText(element.imageDimensions, `${formatBytes(file.size)} | decoding in browser`);
  ui.operation = "image-loading";
  ui.outcome = "none";
  ui.progressMode = "idle";
  ui.stage = null;
  ui.stageStatus = "idle";
  ui.message = "Decoding and retaining the image in this browser...";
  ui.severity = "info";
  ui.technicalError = null;
  renderUi();

  let bitmapResult: ImageBitmap | null = null;
  try {
    if (file.size > INFERENCE_CONFIG.maxImageBytes) {
      throw new Error(`Image exceeds ${formatBytes(INFERENCE_CONFIG.maxImageBytes)}`);
    }
    bitmapResult = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (bitmapResult.width * bitmapResult.height > INFERENCE_CONFIG.maxImagePixels) {
      throw new Error("Image has too many decoded pixels");
    }
    const descriptor: ImageDescriptor = {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      bytes: file.size,
      width: bitmapResult.width,
      height: bitmapResult.height,
    };
    await engine.loadImage(file, descriptor, imageController.signal);
    if (currentLoad !== imageLoadSequence) {
      await engine.releaseImage(descriptor.id);
      return;
    }
    imageController = null;
    bitmap = bitmapResult;
    bitmapResult = null;
    imageDescriptor = descriptor;
  } finally {
    bitmapResult?.close();
    if (currentLoad === imageLoadSequence && !imageDescriptor) imageController = null;
  }

  if (!bitmap) throw new Error("The image could not be prepared");
  const scale = Math.min(1, 1200 / bitmap.width, 1200 / bitmap.height);
  element.canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  element.canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  element.canvasShell.classList.remove("empty");
  element.canvasPlaceholder.hidden = true;
  setText(
    element.imageDimensions,
    `${bitmap.width} x ${bitmap.height} | ${formatBytes(file.size)} | browser source retained`
  );

  start = null;
  end = null;
  clearStaleResult();
  clearEventLog();
  ui.operation = "idle";
  ui.outcome = "none";
  ui.message = engine.isPrepared()
    ? "Image ready. Draw around one object."
    : "Image ready. Load the local model, then draw around one object.";
  ui.severity = "info";
  ui.technicalError = null;
  draw();
  renderUi();
}

async function copyText(value: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("Browser copy command failed");
    }
    setText(button, "Copied");
    setText(element.actionFeedback, "Copied to clipboard.");
  } catch {
    setText(button, "Copy failed");
    setText(element.actionFeedback, "Copy failed. Try again.");
  }
  window.setTimeout(() => setText(button, original), 1200);
}

function runPrimaryAction(): void {
  const action = currentPrimaryAction();
  if (action.intent === "load-model") void loadModel();
  if (action.intent === "choose-image") element.file.click();
  if (action.intent === "focus-selection") {
    element.coordinatePanel.open = true;
    element.x1.focus();
    ui.message = "Set the selection coordinates, or draw around one object with a pointer.";
    ui.severity = "info";
    renderUi();
  }
  if (action.intent === "classify") void classify();
}

element.file.addEventListener("change", async () => {
  const file = element.file.files?.[0];
  if (!file) return;
  try {
    await loadImage(file);
  } catch (error) {
    ui.operation = "idle";
    ui.outcome = "none";
    ui.progressMode = "idle";
    ui.stage = null;
    ui.stageStatus = "idle";
    ui.message =
      error instanceof Error && error.name === "AbortError"
        ? "Image loading cancelled."
        : "The image could not be opened.";
    ui.severity = "error";
    ui.technicalError = errorDetails(error);
    renderUi();
  }
});

element.canvas.addEventListener("pointerdown", (event) => {
  if (!bitmap || ui.operation !== "idle") return;
  element.canvas.setPointerCapture(event.pointerId);
  start = point(event);
  end = start;
  drawing = true;
  clearStaleResult();
  resetSelectionWorkflow();
  ui.message = "Adjust the selection around one object.";
  ui.severity = "info";
  ui.technicalError = null;
  draw();
  renderUi();
});

element.canvas.addEventListener("pointermove", (event) => {
  if (!drawing) return;
  end = point(event);
  draw();
});

element.canvas.addEventListener("pointerup", (event) => {
  if (!drawing) return;
  drawing = false;
  end = point(event);
  syncCoordinateInputs();
  classifyCompletedSelection();
});

element.canvas.addEventListener("pointercancel", () => {
  drawing = false;
  draw();
});

element.shape.addEventListener("change", () => {
  if (!start || !end) return;
  clearStaleResult();
  resetSelectionWorkflow();
  classifyCompletedSelection();
});

element.primaryAction.addEventListener("click", runPrimaryAction);
element.cancel.addEventListener("click", cancelClassification);
element.applyCoordinates.addEventListener("click", applyCoordinateInputs);
element.clearEvents.addEventListener("click", clearEventLog);
element.copyResult.addEventListener("click", () =>
  copyText(JSON.stringify(latest, null, 2) ?? "null", element.copyResult)
);
element.copyDebug.addEventListener("click", () => {
  const debug = {
    capability: capabilityData,
    config: INFERENCE_CONFIG,
    latest,
    events: eventHistory,
  };
  void copyText(JSON.stringify(debug, null, 2) ?? "null", element.copyDebug);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ui.operation === "classifying") cancelClassification();
});

window.addEventListener("pagehide", () => void engine.dispose());

(() => {
  resetResultPresentation();
  clearEventLog();
  clearTimer();
  renderUi();
  void initializeBrowserInference();
})();
