export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let index = 0;
  while (amount >= 1000 && index < units.length - 1) {
    amount /= 1000;
    index += 1;
  }
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function formatDuration(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return "—";
  const milliseconds = value as number;
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${((value as number) * 100).toFixed(digits)}%`;
}

export function formatModelSize(bytes: number): string {
  return `~${Math.round(bytes / 1_000_000)} MB`;
}
