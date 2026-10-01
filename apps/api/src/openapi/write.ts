import "reflect-metadata";
import { writeFileSync } from "node:fs";
import { generateOpenApi, serializeOpenApi } from "./document.js";

const target = process.argv[2] ?? "openapi.json";
writeFileSync(target, serializeOpenApi(generateOpenApi({ includeInternal: true })));
