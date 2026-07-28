import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../model-manifest.json", import.meta.url), "utf8")
);
const failures = [];
for (const artifact of manifest.artifacts) {
  if (!artifact.resolved_url.includes(`/resolve/${manifest.revision}/`))
    failures.push(`${artifact.path}: URL is not revision-pinned`);
  if (artifact.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(artifact.sha256))
    failures.push(`${artifact.path}: invalid SHA-256`);
}
if (manifest.integrity_status === "verified") {
  for (const artifact of manifest.artifacts) {
    if (!artifact.sha256) failures.push(`${artifact.path}: verified manifest requires SHA-256`);
  }
}
if (failures.length) {
  console.error("Model manifest verification failed:\n- " + failures.join("\n- "));
  process.exitCode = 1;
} else {
  const verified = manifest.artifacts.filter((artifact) => artifact.sha256).length;
  console.log(
    `Model manifest structurally valid (${verified}/${manifest.artifacts.length} artifacts include SHA-256).`
  );
}
