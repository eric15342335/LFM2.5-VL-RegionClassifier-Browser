import { describe, expect, it } from "vitest";
import manifest from "../../model-manifest.json";
import packageJson from "../../package.json";
import { parseModelManifest } from "../domain/schemas";

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

  it("pins all six Q8 artifacts", () => {
    const q8 = manifest.artifacts.filter((artifact) => artifact.dtype === "q8");

    expect(q8).toHaveLength(6);
    expect(q8.map((artifact) => artifact.path)).toEqual(
      expect.arrayContaining([
        "onnx/embed_tokens_quantized.onnx",
        "onnx/embed_tokens_quantized.onnx_data",
        "onnx/vision_encoder_quantized.onnx",
        "onnx/vision_encoder_quantized.onnx_data",
        "onnx/decoder_model_merged_quantized.onnx",
        "onnx/decoder_model_merged_quantized.onnx_data",
      ])
    );
    for (const artifact of q8) {
      expect(artifact.resolved_url).toBe(
        `https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${artifact.path}`
      );
      expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("accepts Q8 and rejects unknown dtypes", () => {
    expect(
      parseModelManifest({ ...manifest, dtype: { ...manifest.dtype, embed_tokens: "q8" } }).dtype
        .embed_tokens
    ).toBe("q8");
    expect(() =>
      parseModelManifest({ ...manifest, dtype: { ...manifest.dtype, embed_tokens: "invalid" } })
    ).toThrow();
  });
});
