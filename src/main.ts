import "./styles/app.css";

import { INFERENCE_CONFIG } from "./config";
import { BrowserInferenceEngine } from "./engines/browser-engine";
import type {
  BrowserCapability,
  ClassificationResult,
  ImageDescriptor,
  NormalizedSelection,
  ProgressEvent,
  SelectionShape,
} from "./types";

type Point = { x: number; y: number };
type LatestResult = ClassificationResult & { browser: { round_trip_ms: number } };
type FactEntry = readonly [name: string, value: unknown];
type ResultRow = readonly [name: string, value: unknown, raw?: boolean];

function requiredElement<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required element #${id}`);
  return node as T;
}

const element = {
  file: requiredElement<HTMLInputElement>("file"),
  fileName: requiredElement<HTMLElement>("fileName"),
  shape: requiredElement<HTMLSelectElement>("shape"),
  loadModel: requiredElement<HTMLButtonElement>("loadModel"),
  executionBadge: requiredElement<HTMLElement>("executionBadge"),
  browserModelStatus: requiredElement<HTMLElement>("browserModelStatus"),
  modelStorageEstimate: requiredElement<HTMLElement>("modelStorageEstimate"),
  retry: requiredElement<HTMLButtonElement>("retry"),
  cancel: requiredElement<HTMLButtonElement>("cancel"),
  capabilityPill: requiredElement<HTMLElement>("capabilityPill"),
  capabilityText: requiredElement<HTMLElement>("capabilityText"),
  elapsed: requiredElement<HTMLOutputElement>("elapsed"),
  status: requiredElement<HTMLElement>("status"),
  progressTrack: requiredElement<HTMLProgressElement>("progressTrack"),
  pipeline: requiredElement<HTMLOListElement>("pipeline"),
  label: requiredElement<HTMLElement>("label"),
  probability: requiredElement<HTMLElement>("probability"),
  coverage: requiredElement<HTMLElement>("coverage"),
  totalTime: requiredElement<HTMLElement>("totalTime"),
  inferenceTime: requiredElement<HTMLElement>("inferenceTime"),
  preprocessTime: requiredElement<HTMLElement>("preprocessTime"),
  imageDimensions: requiredElement<HTMLElement>("imageDimensions"),
  canvasShell: requiredElement<HTMLElement>("canvasShell"),
  canvas: requiredElement<HTMLCanvasElement>("canvas"),
  canvasPlaceholder: requiredElement<HTMLElement>("canvasPlaceholder"),
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
  timingBars: requiredElement<HTMLElement>("timingBars"),
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

const stageOrder = ["accepted", "crop", "inference", "complete"] as const;
const coordinateKeys = ["x1", "y1", "x2", "y2"] as const;

let bitmap: ImageBitmap | null = null;
let start: Point | null = null;
let end: Point | null = null;
let drawing = false;
let latest: LatestResult | null = null;
let capabilityData: BrowserCapability | null = null;
let controller: AbortController | null = null;
let imageController: AbortController | null = null;
let imageDescriptor: ImageDescriptor | null = null;
const engine = new BrowserInferenceEngine(INFERENCE_CONFIG);
let imageLoadSequence = 0;
let requestSequence = 0;
let requestStarted = 0;
let timer: number | null = null;
let eventHistory: ProgressEvent[] = [];

function setText(target: Node, value: unknown): void {
  target.textContent = String(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatMilliseconds(value: unknown): string {
  if (!Number.isFinite(Number(value))) return "—";
  const milliseconds = Number(value);
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : `${milliseconds.toFixed(1)} ms`;
}

function formatBytes(value: unknown): string {
  if (!Number.isFinite(Number(value))) return "—";
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

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function point(event: PointerEvent): Point {
  const bounds = element.canvas.getBoundingClientRect();
  return {
    x: clamp(
      ((event.clientX - bounds.left) * element.canvas.width) / bounds.width,
      0,
      element.canvas.width,
    ),
    y: clamp(
      ((event.clientY - bounds.top) * element.canvas.height) / bounds.height,
      0,
      element.canvas.height,
    ),
  };
}

function circleEnd(first: Point, last: Point): Point {
  const side = Math.max(Math.abs(last.x - first.x), Math.abs(last.y - first.y));
  return {
    x: first.x + Math.sign(last.x - first.x || 1) * side,
    y: first.y + Math.sign(last.y - first.y || 1) * side,
  };
}

function finalPoint(): Point {
  if (!start || !end) throw new Error("A selection has not been drawn");
  return element.shape.value === "circle" ? circleEnd(start, end) : end;
}

function normalizedSelection(): NormalizedSelection {
  if (!start) throw new Error("A selection has not been drawn");
  const first = start;
  const last = finalPoint();
  return {
    x1: clamp(Math.min(first.x, last.x) / element.canvas.width, 0, 1),
    y1: clamp(Math.min(first.y, last.y) / element.canvas.height, 0, 1),
    x2: clamp(Math.max(first.x, last.x) / element.canvas.width, 0, 1),
    y2: clamp(Math.max(first.y, last.y) / element.canvas.height, 0, 1),
  };
}

function syncCoordinateInputs(): void {
  if (!start || !end) return;
  const selection = normalizedSelection();
  for (const key of coordinateKeys) {
    element[key].value = (selection[key] * 100).toFixed(1);
  }
}

function applyCoordinateInputs(): void {
  if (!bitmap) return;
  const values: NormalizedSelection = {
    x1: clamp(Number(element.x1.value) / 100, 0, 1),
    y1: clamp(Number(element.y1.value) / 100, 0, 1),
    x2: clamp(Number(element.x2.value) / 100, 0, 1),
    y2: clamp(Number(element.y2.value) / 100, 0, 1),
  };
  start = { x: values.x1 * element.canvas.width, y: values.y1 * element.canvas.height };
  end = { x: values.x2 * element.canvas.width, y: values.y2 * element.canvas.height };
  latest = null;
  draw();
  classify();
}

function strokeNormalizedBox(box: readonly number[], color: string, width: number, dashed = false): void {
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = box;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.setLineDash(dashed ? [10, 7] : []);
  context.strokeRect(
    x1 * element.canvas.width,
    y1 * element.canvas.height,
    (x2 - x1) * element.canvas.width,
    (y2 - y1) * element.canvas.height,
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
  if (latest?.crop?.cropBox) {
    strokeNormalizedBox(latest.crop.cropBox, "#4ade80", 3, true);
  }
  drawSelection();
}

function drawCropPreview(result: ClassificationResult): void {
  if (!bitmap || !result?.crop?.cropBox) return;
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
    element.cropPreview.height,
  );
  setText(
    element.cropDimensions,
    `${result.crop.cropSizeBeforeResize.join(" × ")} → ${result.crop.modelImageSize.join(" × ")}`,
  );
}

function setProgress(stage: string, progress: number, message: string): void {
  const currentIndex = stageOrder.indexOf(stage as (typeof stageOrder)[number]);
  const bounded = clamp(Number(progress) || 0, 0, 100);
  element.progressTrack.value = bounded;
  if (message) setText(element.status, message);

  for (const item of element.pipeline.querySelectorAll("li")) {
    const index = stageOrder.indexOf(item.dataset.stage as (typeof stageOrder)[number]);
    item.classList.toggle("done", index < currentIndex || stage === "complete");
    item.classList.toggle("active", index === currentIndex && stage !== "complete");
  }
}

function resetProgress(): void {
  setProgress("", 0, "Choose an image, then draw around one object.");
  element.status.classList.remove("error");
  for (const item of element.pipeline.querySelectorAll("li")) {
    item.classList.remove("done", "active");
  }
  setText(element.elapsed, "0 ms");
}

function startTimer(): void {
  stopTimer();
  requestStarted = performance.now();
  timer = window.setInterval(() => {
    setText(element.elapsed, formatMilliseconds(performance.now() - requestStarted));
  }, 100);
}

function stopTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function setBusy(busy: boolean): void {
  element.retry.disabled = busy || !engine.isPrepared() || !bitmap || !imageDescriptor || !start || !end;
  element.cancel.disabled = !busy;
  element.file.disabled = busy;
  element.shape.disabled = busy;
  element.applyCoordinates.disabled = busy || !bitmap;
  element.canvas.classList.toggle("busy", busy);
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
  const status = capability.supported ? "WEBGPU" : "UNAVAILABLE";
  setText(element.deviceBadge, status);

  const adapterName = formatValue(
    adapter.description ?? adapter.device ?? adapter.architecture ?? "WebGPU adapter",
  );
  const storageSummary = storage?.quota
    ? `${formatBytes(storage.available)} storage available`
    : "Storage estimate unavailable";
  setText(
    element.hardwareSummary,
    capability.supported
      ? `${adapterName} · ${storageSummary}`
      : capability.reason || "Browser WebGPU capability check failed",
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
    ["Model headroom", storage?.required ? formatBytes(storage.required) : null],
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
    ["Estimated download", formatBytes(model.estimated_download_bytes)],
    ["License", model.license],
  ]);
}

function renderTimings(performanceData: ClassificationResult["performance"]): void {
  const entries: Array<[string, number]> = [
    ["Preprocess", performanceData.preprocessMs],
    ["WebGPU inference", performanceData.webgpuInferenceMs],
  ].filter((entry): entry is [string, number] => Number.isFinite(entry[1]));

  if (!entries.length) return;
  const total = Math.max(Number(performanceData.totalMs) || 0, 1);
  const fragment = document.createDocumentFragment();
  for (const [name, value] of entries) {
    const row = document.createElement("div");
    row.className = "timing-row";
    const header = document.createElement("div");
    header.className = "timing-label";
    const label = document.createElement("span");
    const duration = document.createElement("span");
    setText(label, name);
    setText(duration, formatMilliseconds(value));
    header.append(label, duration);

    const track = document.createElement("div");
    track.className = "timing-track";
    const bar = document.createElement("span");
    bar.style.width = `${clamp((Number(value) / total) * 100, 1.5, 100)}%`;
    track.append(bar);
    row.append(header, track);
    fragment.append(row);
  }
  element.timingBars.replaceChildren(fragment);
}

function renderRows(entries: readonly ResultRow[]): void {
  const fragment = document.createDocumentFragment();
  for (const [name, value, raw = false] of entries) {
    const row = document.createElement("tr");
    const key = document.createElement("th");
    const cell = document.createElement("td");
    key.scope = "row";
    setText(key, name);
    setText(cell, typeof value === "string" ? value : JSON.stringify(value, null, 2));
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

function render(result: ClassificationResult, roundTrip: number): void {
  latest = { ...result, browser: { round_trip_ms: Number(roundTrip.toFixed(3)) } };
  setText(element.elapsed, formatMilliseconds(roundTrip));
  const probability = result.tokenProbability;
  setText(element.label, result.label);
  setText(
    element.probability,
    probability === null || probability === undefined
      ? "Not returned"
      : `${(Number(probability) * 100).toFixed(1)}%`,
  );
  setText(element.coverage, `${(Number(result.crop.selectedFractionOfCrop) * 100).toFixed(1)}%`);
  setText(element.totalTime, formatMilliseconds(result.performance.totalMs));
  setText(element.inferenceTime, formatMilliseconds(result.performance.webgpuInferenceMs));
  setText(element.preprocessTime, formatMilliseconds(result.performance.preprocessMs));

  renderTimings(result.performance);
  renderRows([
    ["Cleaned label", result.label],
    ["Raw output", result.generation.rawOutput, true],
    ["Finish reason", result.generation.finishReason],
    ["Mean token probability", result.tokenProbability],
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

function clearEventLog(): void {
  eventHistory = [];
  const empty = document.createElement("li");
  empty.className = "empty-copy";
  setText(empty, "No request events yet.");
  element.eventLog.replaceChildren(empty);
}

function addEvent(event: ProgressEvent): void {
  if (eventHistory.length === 0) element.eventLog.replaceChildren();
  eventHistory.push(event);

  const item = document.createElement("li");
  const heading = document.createElement("div");
  heading.className = "event-heading";
  const stage = document.createElement("strong");
  const time = document.createElement("time");
  setText(stage, event.stage || event.event);
  setText(time, formatMilliseconds(event.elapsedMs));
  heading.append(stage, time);

  const message = document.createElement("p");
  setText(message, event.message || "");
  item.append(heading, message);

  if (event.detail && Object.keys(event.detail).length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const code = document.createElement("code");
    setText(summary, "Details");
    setText(code, JSON.stringify(event.detail, null, 2));
    details.append(summary, code);
    item.append(details);
  }
  element.eventLog.append(item);
}

function cancelActiveRequest(): void {
  controller?.abort();
  imageController?.abort();
  engine.cancel();
}

function renderEngineState(): void {
  element.executionBadge.className = "badge execution browser";
  setText(element.executionBadge, engine.isPrepared() ? "Browser WebGPU ready" : "Browser WebGPU");
  setText(
    element.browserModelStatus,
    engine.isPrepared()
      ? "Downloaded, compiled, and warmed up"
      : "Not loaded in this browser session",
  );
}

async function classify(): Promise<void> {
  if (!imageDescriptor || !start || !end) return;
  const selection = normalizedSelection();
  if (selection.x2 - selection.x1 < 0.01 || selection.y2 - selection.y1 < 0.01) {
    element.status.classList.add("error");
    setText(element.status, "Selection is too small.");
    return;
  }

  requestSequence += 1;
  const currentRequest = requestSequence;
  controller?.abort();
  controller = new AbortController();
  if (!engine.isPrepared()) {
    element.status.classList.add("error");
    setText(element.status, "Load the browser model before classifying.");
    return;
  }
  clearEventLog();
  setBusy(true);
  element.status.classList.remove("error");
  setProgress("accepted", 2, "Starting browser inference…");
  startTimer();

  try {
    const result = await engine.classify({
      imageId: imageDescriptor.id,
      region: { ...selection, shape: element.shape.value as SelectionShape },
      signal: controller.signal,
      onProgress(event) {
        if (currentRequest !== requestSequence) return;
        setProgress(event.stage, event.progress, event.message);
        addEvent(event);
      },
    });
    if (currentRequest !== requestSequence) return;
    const roundTrip = performance.now() - requestStarted;
    render(result, roundTrip);
    setProgress("complete", 100, `Browser: ${result.label}`);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      setProgress("", 0, "Request cancelled.");
    } else {
      element.status.classList.add("error");
      setText(element.status, error instanceof Error ? error.message : String(error));
      addEvent({
        event: "error",
        stage: "error",
        message: String(error),
        elapsedMs: performance.now() - requestStarted,
        progress: 0,
      });
    }
  } finally {
    stopTimer();
    setBusy(false);
  }
}

async function initializeBrowserInference(): Promise<void> {
  renderEngine();
  renderJson(element.rawCapability, { config: INFERENCE_CONFIG });
  setText(
    element.modelStorageEstimate,
    `${formatBytes(INFERENCE_CONFIG.model.estimated_download_bytes)} model download; browser cache may be evicted`,
  );

  try {
    capabilityData = await engine.probe();
    renderBrowserCapability(capabilityData);
    renderJson(element.rawCapability, { capability: capabilityData, config: INFERENCE_CONFIG });
    if (!capabilityData.supported) throw new Error(capabilityData.reason || "WebGPU is unavailable");

    element.capabilityPill.className = "capability-pill ok";
    setText(element.capabilityText, "Browser WebGPU available");
    element.loadModel.disabled = false;
    element.copyDebug.disabled = false;
    renderEngineState();
  } catch (error) {
    element.capabilityPill.className = "capability-pill error";
    setText(element.capabilityText, "Browser inference unavailable");
    element.status.classList.add("error");
    setText(element.status, error instanceof Error ? error.message : String(error));
    renderJson(element.rawCapability, { capability: capabilityData, error: String(error), config: INFERENCE_CONFIG });
  }
}

async function loadImage(file: File): Promise<void> {
  controller?.abort();
  requestSequence += 1;
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
  setText(element.imageDimensions, `${formatBytes(file.size)} · decoding in browser`);
  setBusy(true);
  element.status.classList.remove("error");
  setText(element.status, "Decoding and retaining the image in this browser…");

  if (file.size > INFERENCE_CONFIG.maxImageBytes) {
    throw new Error(`Image exceeds ${formatBytes(INFERENCE_CONFIG.maxImageBytes)}`);
  }
  let bitmapResult: ImageBitmap | null = null;
  try {
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
  const scale = Math.min(1, 1200 / bitmap.width, 1200 / bitmap.height);
  element.canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  element.canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  element.canvasShell.classList.remove("empty");
  element.canvasPlaceholder.hidden = true;
  setText(element.fileName, file.name);
  setText(element.imageDimensions, `${bitmap.width} × ${bitmap.height} · ${formatBytes(file.size)} · browser source retained`);

  start = null;
  end = null;
  latest = null;
  resetProgress();
  clearEventLog();
  const metricTargets: Node[] = [
    element.label,
    element.probability,
    element.coverage,
    element.totalTime,
    element.inferenceTime,
    element.preprocessTime,
    element.cropDimensions,
  ];
  for (const target of metricTargets) setText(target, "—");
  element.cropPreview.width = 1;
  element.cropPreview.height = 1;
  cropContext.clearRect(0, 0, 1, 1);
  renderJson(element.rawResult, null);
  element.copyResult.disabled = true;
  setBusy(false);
  draw();
  setText(element.status, "Draw around one subject; inference starts when you release.");
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
  } catch {
    setText(button, "Copy failed");
  }
  window.setTimeout(() => setText(button, original), 1200);
}

element.file.addEventListener("change", async () => {
  const file = element.file.files?.[0];
  if (!file) return;
  try {
    await loadImage(file);
  } catch (error) {
    setBusy(false);
    if (error instanceof Error && error.name === "AbortError") {
      setText(element.status, "Image loading cancelled.");
      return;
    }
    element.status.classList.add("error");
    setText(element.status, `Could not open image: ${error}`);
  }
});

element.canvas.addEventListener("pointerdown", (event) => {
  if (!bitmap || element.canvas.classList.contains("busy")) return;
  element.canvas.setPointerCapture(event.pointerId);
  start = point(event);
  end = start;
  drawing = true;
  latest = null;
  draw();
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
  draw();
  classify();
});

element.canvas.addEventListener("pointercancel", () => {
  drawing = false;
  draw();
});

element.shape.addEventListener("change", () => {
  draw();
  if (start && end) classify();
});

element.loadModel.addEventListener("click", async () => {
  element.loadModel.disabled = true;
  element.status.classList.remove("error");
  try {
    await engine.prepare((event) => {
      setProgress(event.stage, event.progress, event.message);
      addEvent(event);
    });
    setText(element.status, "Browser model loaded and warmed up. Inference stays on this device.");
    setText(element.loadModel, "Model ready");
    renderEngineState();
    setBusy(false);
  } catch (error) {
    element.status.classList.add("error");
    setText(element.status, `Model loading failed: ${error instanceof Error ? error.message : String(error)}`);
    element.loadModel.disabled = false;
  }
});

element.retry.addEventListener("click", classify);
element.cancel.addEventListener("click", cancelActiveRequest);
element.applyCoordinates.addEventListener("click", applyCoordinateInputs);
element.clearEvents.addEventListener("click", clearEventLog);
element.copyResult.addEventListener("click", () =>
  copyText(JSON.stringify(latest, null, 2) ?? "null", element.copyResult),
);
element.copyDebug.addEventListener("click", () => {
  const debug = { capability: capabilityData, config: INFERENCE_CONFIG, latest, events: eventHistory };
  copyText(JSON.stringify(debug, null, 2) ?? "null", element.copyDebug);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !element.cancel.disabled) cancelActiveRequest();
});

window.addEventListener("pagehide", () => void engine.dispose());

(async () => {
  resetProgress();
  setBusy(false);
  await initializeBrowserInference();
})();
