import { describe, expect, it } from "vitest";
import { estimateDownloadProgress } from "../download-progress";

describe("download progress", () => {
  it("calculates percent and ETA from the predicted download size", () => {
    expect(estimateDownloadProgress(143_250_000, 573_000_000, 30_000)).toEqual({
      downloadedBytes: 143_250_000,
      predictedBytes: 573_000_000,
      percentage: 25,
      remainingSeconds: 90,
    });
  });

  it("does not over-report cached or unknown progress", () => {
    expect(estimateDownloadProgress(600, 500, 1_000)).toMatchObject({
      downloadedBytes: 500,
      percentage: 100,
      remainingSeconds: 0,
    });
    expect(estimateDownloadProgress(0, 573_000_000, 1_000).remainingSeconds).toBeNull();
  });
});
