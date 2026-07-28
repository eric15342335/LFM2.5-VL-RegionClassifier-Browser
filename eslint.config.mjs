import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

const logicalBlockSpacing = [
  "error",
  { blankLine: "always", prev: "*", next: "return" },
  { blankLine: "always", prev: ["const", "let", "var"], next: "*" },
  { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
];

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "padding-line-between-statements": logicalBlockSpacing,
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker, ...globals.node },
    },
    rules: { "padding-line-between-statements": logicalBlockSpacing },
  },
  eslintConfigPrettier
);
