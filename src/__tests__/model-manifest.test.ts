import { describe, expect, it } from "vitest";
import manifest from "../../model-manifest.json";
import packageJson from "../../package.json";

const transformerSpecifier = packageJson.dependencies["@huggingface/transformers"];
const transformerVersion = transformerSpecifier.replace(/^[~^]/, "");

describe("model manifest", () => {
  it("pins every model URL to one immutable revision", () => {
    expect(manifest.revision).toMatch(/^[a-f0-9]{40}$/);
    for (const artifact of manifest.artifacts) {
      expect(artifact.resolved_url).toContain(`/resolve/${manifest.revision}/`);
    }
  });

  it("keeps the declared runtime version and verified download estimate consistent", () => {
    const expectedBytes = manifest.artifacts.reduce(
      (total, artifact) => total + (artifact.expected_bytes ?? 0),
      0
    );

    expect(manifest.transformers_js_version).toBe(transformerVersion);
    expect(manifest.estimated_download_bytes).toBe(573_000_000);
    expect(manifest.estimated_download_bytes).toBe(expectedBytes);
  });
});
