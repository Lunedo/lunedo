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
);
