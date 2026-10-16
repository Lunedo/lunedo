import type { Readable } from "node:stream";
import type { SceneProblem } from "@pagehall/editor-schema/scene";
import { FileTooLargeError } from "../files/files.js";

export class SceneInvalidError extends Error {
  override name = "SceneInvalidError";

  constructor(readonly problems: SceneProblem[]) {
    super("The whiteboard scene is not valid");
  }
}

export async function readText(body: Readable, maxBytes: number): Promise<string> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += part.length;
    if (size > maxBytes) {
      body.destroy();
      throw new FileTooLargeError(maxBytes);
    }
    parts.push(part);
  }
  return Buffer.concat(parts).toString("utf8");
}

export function parseScene(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SceneInvalidError([{ path: "", code: "notSerializable" }]);
  }
}
