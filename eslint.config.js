// ESLint runs only the type-aware promise rules that Biome cannot check reliably.
// Formatting and all other linting are done by Biome.
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/dist/", "**/generated/", "**/node_modules/", "**/.turbo/", "apps/web/test-results/"]),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["describe", "it", "test"] },
          ],
        },
      ],
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/format/**", "**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name=/^toLocale(Date|Time)?String$/]",
          message:
            "Format dates and times with the formatter from useFormat() so that every screen reads alike.",
        },
        {
          selector: "MemberExpression[object.name='Intl'][property.name='DateTimeFormat']",
          message:
            "Format dates and times with the formatter from useFormat(), or add a helper to apps/web/src/format.",
        },
      ],
    },
  },
);
