import { appendFileSync } from "node:fs";
import { parseRequests, pickPorts } from "./free-ports.ts";

const ports = await pickPorts(parseRequests(process.argv.slice(2)));
const lines = Object.entries(ports).map(([name, port]) => `${name}=${port}`);
console.log(lines.join("\n"));
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
