import { describe, expect, it } from "vitest";
import manifest from "../../model-manifest.json";
import { parseModelManifest } from "../domain/schemas";

describe("runtime schemas", () => {
  it("accepts the pinned manifest", () => {
    expect(parseModelManifest(manifest)).toMatchObject({
      runtime: "webgpu",
      revision: manifest.revision,
      artifacts: expect.arrayContaining([expect.objectContaining({ role: "vision" })]),
    });
  });

  it("rejects mutable revisions and invalid integrity hashes", () => {
    expect(() => parseModelManifest({ ...manifest, revision: "main" })).toThrow();
    expect(() =>
      parseModelManifest({
        ...manifest,
        artifacts: [{ ...manifest.artifacts[0], sha256: "not-a-hash" }],
      })
    ).toThrow();
  });
});
