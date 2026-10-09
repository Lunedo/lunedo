import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { turboInvocation } from "./turbo-invocation.ts";

const turbo = createRequire(import.meta.url).resolve("turbo/bin/turbo");
const { args, env } = turboInvocation(process.argv.slice(2), process.env);
const result = spawnSync(process.execPath, [turbo, ...args], { stdio: "inherit", env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
