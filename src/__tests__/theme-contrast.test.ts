import { DEFAULT_THEME } from "@mantine/core";
import { describe, expect, it } from "vitest";
import { accessibleCssVariablesResolver } from "../theme";

function linearize(channel: number): number {
  const value = channel / 255;

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(foreground: string, background: string): number {
  const parse = (color: string): number[] => {
    const hex = color.replace(/^#/, "");
    const expanded = hex.length === 3 ? hex.replace(/./g, (value) => value + value) : hex;

    return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16));
  };
  const luminance = (color: string): number => {
    const [red, green, blue] = parse(color);

    return 0.2126 * linearize(red!) + 0.7152 * linearize(green!) + 0.0722 * linearize(blue!);
  };
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

describe("accessible dimmed color variables", () => {
  const resolved = accessibleCssVariablesResolver(DEFAULT_THEME);
  const lightDimmed = resolved.light["--mantine-color-dimmed"]!;
  const darkDimmed = resolved.dark["--mantine-color-dimmed"]!;

  it.each([
    ["light body", lightDimmed, DEFAULT_THEME.white],
    ["light Dropzone hover", lightDimmed, DEFAULT_THEME.colors.gray[0]],
    ["dark body/Paper/AppShell", darkDimmed, DEFAULT_THEME.colors.dark[7]],
    ["dark Dropzone idle", darkDimmed, DEFAULT_THEME.colors.dark[6]],
    ["dark Dropzone hover", darkDimmed, DEFAULT_THEME.colors.dark[5]],
  ])("keeps %s above the WCAG AA threshold", (_surface, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});
