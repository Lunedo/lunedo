import { contentUrl, fetchBytes } from "../files/attachments-api.js";
import { putBytes } from "../whiteboards/whiteboard-api.js";

export type DiagramKind = "drawio" | "mermaid" | "plantuml";

export interface StoredSource {
  sourceId: string;
  sourceVersion: number;
  text: string;
}

export interface StoredImage {
  previewId: string;
  previewVersion: number;
  text: string;
}

export function storeDrawio(pageId: string, blockId: string, xml: string): Promise<StoredSource> {
  return putBytes(
    `/api/v1/pages/${pageId}/diagrams/${blockId}/drawio`,
    new Blob([xml], { type: "application/xml" }),
  );
}

export function storeImage(
  pageId: string,
  blockId: string,
  kind: DiagramKind,
  svg: string,
): Promise<StoredImage> {
  return putBytes(
    `/api/v1/pages/${pageId}/diagrams/${blockId}/image?type=${kind}`,
    new Blob([svg], { type: "image/svg+xml" }),
  );
}

export async function loadText(attachmentId: string, version: number): Promise<string> {
  const bytes = await fetchBytes(contentUrl(attachmentId, { version }));
  return new TextDecoder().decode(bytes);
}
