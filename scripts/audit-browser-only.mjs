import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
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
  "src/engines",
  "src/worker",
  "src/main.ts",
  "src/ui-state.ts",
  "src/styles/app.css",
  "src/styles/ui-overrides.css",
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
  /WorkerRequest|WorkerResponse|postMessage\s*\(/,
  /requiredElement|requiredCanvasContext/,
];
const textExtensions = new Set([".html", ".json", ".md", ".mjs", ".ts", ".tsx", ".css"]);

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
    if ([".git", ".pnpm-store", "dist", "node_modules"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else output.push(path);
  }
  return output;
}

const failures = [];
for (const path of forbiddenPaths)
  if (await exists(path)) failures.push(`forbidden path exists: ${path}`);

for (const path of await walk(rootPath)) {
  if (!textExtensions.has(extname(path))) continue;
  const name = relative(rootPath, path).replaceAll("\\", "/");
  if (
    name === "scripts/audit-browser-only.mjs" ||
    name.startsWith("frontend-rewrite-audit-bundle/")
  )
    continue;
  const text = await readFile(path, "utf8");
  for (const pattern of forbiddenText)
    if (pattern.test(text)) failures.push(`forbidden reference ${pattern} in ${name}`);
}

const html = await readFile(new URL("index.html", rootUrl), "utf8");
const main = await readFile(new URL("src/main.tsx", rootUrl), "utf8");
if (!/<div id="root"><\/div>/.test(html)) failures.push("index.html is missing the React root");
if (!/createRoot\(root\)\.render/.test(main)) failures.push("src/main.tsx does not mount React");
if ((html.match(/\bid="/g) ?? []).length !== 1)
  failures.push("index.html should contain only the React root ID");

const manifest = JSON.parse(await readFile(new URL("model-manifest.json", rootUrl), "utf8"));
if (manifest.runtime !== "webgpu") failures.push("model manifest runtime is not webgpu");
if (!/^[a-f0-9]{40}$/.test(manifest.revision))
  failures.push("model manifest revision is not a pinned 40-character commit");
for (const artifact of manifest.artifacts ?? []) {
  if (!artifact.resolved_url?.includes(`/resolve/${manifest.revision}/`))
    failures.push(`artifact URL is not pinned: ${artifact.path}`);
  if (artifact.sha256 && !/^[a-f0-9]{64}$/.test(artifact.sha256))
    failures.push(`invalid SHA-256: ${artifact.path}`);
}
if (
  manifest.integrity_status === "verified" &&
  manifest.artifacts.some((artifact) => !artifact.sha256)
)
  failures.push("verified manifest has artifacts without SHA-256 values");

if (failures.length) {
  console.error("Browser-only audit failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  console.log(
    `Browser-only audit passed (React root, ${manifest.artifacts.length} pinned model artifacts).`
  );
}
