import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tokens } from "./index.js";
import { generateThemeCss } from "./theme.js";

const target = fileURLToPath(new URL("../generated/theme.css", import.meta.url));
mkdirSync(fileURLToPath(new URL("../generated/", import.meta.url)), { recursive: true });
writeFileSync(target, generateThemeCss(tokens));
