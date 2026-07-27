import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const productionExtensions = new Set([".html", ".css", ".ts", ".tsx"]);

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "dist", "node_modules", "frontend-rewrite-audit-bundle"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await walk(path)));
    else output.push(path);
  }
  return output;
}

const files = [];
for (const path of await walk(root)) {
  const name = relative(root, path).replaceAll("\\", "/");
  const extension = extname(path);
  if (!productionExtensions.has(extension)) continue;
  if (name.includes("/__tests__/") || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
  if (name.startsWith("vite.config.")) continue;
  const text = await readFile(path, "utf8");
  const lines = text.split(/\r?\n/);
  files.push({
    name,
    extension,
    physical: lines.length - (lines.at(-1) === "" ? 1 : 0),
    nonblank: lines.filter((line) => line.trim()).length,
  });
}

const sum = (predicate, field) => files.filter(predicate).reduce((total, file) => total + file[field], 0);
const report = {
  productionPhysicalLoc: sum(() => true, "physical"),
  productionNonblankLoc: sum(() => true, "nonblank"),
  typescriptPhysicalLoc: sum((file) => file.extension === ".ts" || file.extension === ".tsx", "physical"),
  cssPhysicalLoc: sum((file) => file.extension === ".css", "physical"),
  htmlPhysicalLoc: sum((file) => file.extension === ".html", "physical"),
  sourceFiles: files.map((file) => file.name),
};
console.log(JSON.stringify(report, null, 2));
