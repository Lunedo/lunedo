import { parentPort } from "node:worker_threads";
import mammoth from "mammoth";
import { MEDIA_PREFIX } from "./html.js";

export interface WordConversionRequest {
  zip: Uint8Array<ArrayBuffer>;
  idPrefix: string;
}

export type WordConversionReply =
  | { status: "converted"; html: string; unreadableImages: boolean }
  | { status: "damaged" };

export async function convertWordZip(request: WordConversionRequest): Promise<WordConversionReply> {
  let unreadableImages = false;
  try {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(request.zip.buffer, request.zip.byteOffset, request.zip.byteLength) },
      {
        idPrefix: request.idPrefix,
        ignoreEmptyParagraphs: true,
        externalFileAccess: false,
        convertImage: mammoth.images.imgElement(async (image) => {
          const placeholder = (await image.readAsBuffer()).toString("utf8");
          if (!placeholder.startsWith(MEDIA_PREFIX)) {
            unreadableImages = true;
            return { src: "" };
          }
          return { src: placeholder };
        }),
      },
    );
    return { status: "converted", html: result.value, unreadableImages };
  } catch {
    return { status: "damaged" };
  }
}

export function serve(): void {
  parentPort?.once("message", (request: WordConversionRequest) => {
    void convertWordZip(request).then((reply) => parentPort?.postMessage(reply));
  });
}
