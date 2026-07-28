import type { CSSVariablesResolver } from "@mantine/core";

export const accessibleCssVariablesResolver: CSSVariablesResolver = (theme) => ({
  variables: {},
  light: {
    "--mantine-color-dimmed": theme.colors.gray[7],
  },
  dark: {
    "--mantine-color-dimmed": theme.colors.dark[1],
  },
});
