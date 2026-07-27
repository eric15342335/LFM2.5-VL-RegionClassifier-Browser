import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("browser-only structural audit", () => {
  it("passes from the project root", () => {
    const output = execFileSync(process.execPath, ["scripts/audit-browser-only.mjs"], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    expect(output).toMatch(/Browser-only audit passed/);
  });
});
