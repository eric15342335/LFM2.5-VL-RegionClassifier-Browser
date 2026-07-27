export type DownloadProgress = Readonly<{
  downloadedBytes: number;
  predictedBytes: number;
  percentage: number;
  remainingSeconds: number | null;
}>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function estimateDownloadProgress(
  downloadedBytes: number,
  predictedBytes: number,
  elapsedMilliseconds: number
): DownloadProgress {
  const total = Math.max(0, predictedBytes);
  const downloaded = clamp(downloadedBytes, 0, total);
  const percentage = total > 0 ? (downloaded / total) * 100 : 0;
  const canEstimate = downloaded > 0 && elapsedMilliseconds > 0;
  const bytesPerSecond = canEstimate ? downloaded / (elapsedMilliseconds / 1000) : 0;
  const remainingSeconds = bytesPerSecond > 0 ? (total - downloaded) / bytesPerSecond : null;

  return { downloadedBytes: downloaded, predictedBytes: total, percentage, remainingSeconds };
}
