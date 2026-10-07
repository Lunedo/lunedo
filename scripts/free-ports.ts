import { createServer } from "node:net";

const firstPort = 20_000;
const lastPort = 32_000;

export interface PortRequest {
  name: string;
  span: number;
}

export function parseRequests(args: readonly string[]): PortRequest[] {
  return args.map((arg) => {
    const match = /^([A-Z][A-Z0-9_]*)(?::([1-9][0-9]*))?$/.exec(arg);
    if (!match?.[1]) throw new Error(`Invalid port request "${arg}". Use NAME or NAME:SPAN.`);
    return { name: match[1], span: Number(match[2] ?? 1) };
  });
}

export function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => server.close(() => resolve(true)));
  });
}

export async function pickPorts(
  requests: readonly PortRequest[],
  free: (port: number) => Promise<boolean> = isFree,
  random: () => number = Math.random,
): Promise<Record<string, number>> {
  const taken = new Set<number>();
  const result: Record<string, number> = {};
  for (const request of requests) {
    let picked: number | undefined;
    for (let attempt = 0; attempt < 200 && picked === undefined; attempt += 1) {
      const start = firstPort + Math.floor(random() * (lastPort - firstPort - request.span));
      const range = Array.from({ length: request.span }, (_, index) => start + index);
      if (range.some((port) => taken.has(port))) continue;
      const states = await Promise.all(range.map((port) => free(port)));
      if (states.every(Boolean)) picked = start;
    }
    if (picked === undefined) throw new Error(`No free port range found for ${request.name}.`);
    for (let index = 0; index < request.span; index += 1) taken.add(picked + index);
    result[request.name] = picked;
  }
  return result;
}
