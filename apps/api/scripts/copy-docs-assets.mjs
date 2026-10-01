import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(import.meta.resolve("@scalar/api-reference"));
mkdirSync("dist/docs", { recursive: true });
copyFileSync(join(dirname(entry), "browser", "standalone.js"), "dist/docs/scalar.js");
