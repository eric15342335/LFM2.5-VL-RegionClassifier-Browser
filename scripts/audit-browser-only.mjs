import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootUrl = new URL("../", import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const forbiddenPaths = [
  ".env.example",
  "backend.py",
  "pyproject.toml",
  "uv.lock",
  "static",
  "tests/test_backend.py",
  "src/engines/hybrid-router.ts",
  "src/engines/local-engine.ts",
  "src/engines/server-engine.ts",
  "src/worker/local-inference.worker.ts",
];
const forbiddenText = [
  /\/client-config\b/,
  /\/health\b/,
  /\/classify(?:-stream)?\b/,
  /HybridInferenceRouter/,
  /ServerEngine/,
  /FastAPI/,
  /llama\.cpp/,
  /\bvLLM\b/,
  /server fallback/i,
  /image-upload consent/i,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /new\s+WebSocket\s*\(/,
];
const textExtensions = new Set([".html", ".json", ".md", ".mjs", ".ts", ".css"]);

async function exists(path) {
  try {
    await stat(new URL(path, rootUrl));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if ([".git", "dist", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else output.push(path);
  }
  return output;
}

const failures = [];
for (const path of forbiddenPaths) {
  if (await exists(path)) failures.push(`forbidden path exists: ${path}`);
}

for (const path of await walk(rootPath)) {
  const extension = path.slice(path.lastIndexOf("."));
  if (!textExtensions.has(extension)) continue;
  const name = relative(rootPath, path).replaceAll("\\", "/");
  if (name === "scripts/audit-browser-only.mjs") continue;
  const text = await readFile(path, "utf8");
  for (const pattern of forbiddenText) {
    if (pattern.test(text)) failures.push(`forbidden reference ${pattern} in ${name}`);
  }
}

const html = await readFile(new URL("index.html", rootUrl), "utf8");
const main = await readFile(new URL("src/main.ts", rootUrl), "utf8");
const htmlIdList = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const htmlIds = new Set(htmlIdList);
if (htmlIds.size !== htmlIdList.length) failures.push("index.html contains duplicate element IDs");
const uiIds = new Set(
  [...main.matchAll(/requiredElement(?:<[^>]+>)?\("([^"]+)"\)/g)].map((match) => match[1])
);
for (const id of uiIds) {
  if (!htmlIds.has(id)) failures.push(`src/main.ts requires missing DOM id: ${id}`);
}

const manifest = JSON.parse(await readFile(new URL("model-manifest.json", rootUrl), "utf8"));
if (manifest.runtime !== "webgpu") failures.push("model manifest runtime is not webgpu");
if (!/^[a-f0-9]{40}$/.test(manifest.revision))
  failures.push("model manifest revision is not a pinned 40-character commit");
let expectedModelBytes = 0;
for (const artifact of manifest.artifacts ?? []) {
  if (artifact.resolved_url && !artifact.resolved_url.includes(manifest.revision)) {
    failures.push(`artifact URL is not pinned: ${artifact.path}`);
  }
  if (Number.isFinite(artifact.expected_bytes)) expectedModelBytes += artifact.expected_bytes;
}
if (expectedModelBytes !== manifest.estimated_download_bytes) {
  failures.push(
    `model byte estimate mismatch: manifest=${manifest.estimated_download_bytes}, artifacts=${expectedModelBytes}`
  );
}

if (failures.length) {
  console.error("Browser-only audit failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(
    `Browser-only audit passed (${uiIds.size} UI bindings, ${manifest.artifacts.length} model artifacts).`
  );
}
