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

  it("contains every plain-Q4 component and external data file", () => {
    const q4Paths = manifest.artifacts
      .filter((artifact) => artifact.dtype === "q4")
      .map((artifact) => artifact.path);

    expect(q4Paths).toEqual(
      expect.arrayContaining([
        "onnx/embed_tokens_q4.onnx",
        "onnx/embed_tokens_q4.onnx_data",
        "onnx/vision_encoder_q4.onnx",
        "onnx/vision_encoder_q4.onnx_data",
        "onnx/decoder_model_merged_q4.onnx",
        "onnx/decoder_model_merged_q4.onnx_data",
      ])
    );
    expect(q4Paths).toHaveLength(6);
  });

  it("keeps the declared runtime version consistent", () => {
    expect(manifest.transformers_js_version).toBe(transformerVersion);
  });
});
