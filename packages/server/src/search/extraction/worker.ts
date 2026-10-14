import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

if (import.meta.url.endsWith(".ts")) {
  registerHooks({
    resolve(specifier, context, next) {
      try {
        return next(specifier, context);
      } catch (error) {
        if (!specifier.startsWith(".") || !specifier.endsWith(".js")) throw error;
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
    },
    load(url, context, next) {
      if (!url.startsWith("file:") || !url.endsWith(".ts")) return next(url, context);
      const source = readFileSync(fileURLToPath(url), "utf8");
      return {
        format: "module",
        source: stripTypeScriptTypes(source, { mode: "transform", sourceUrl: url }),
        shortCircuit: true,
      };
    },
  });
}

const { serve } = await import("./serve.js");
serve();
