import { DRAWIO_PATH, drawioLanguage } from "./drawio-version.js";

export const EMPTY_DRAWIO =
  '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

export type DrawioEvent =
  | { event: "init" }
  | { event: "load" }
  | { event: "autosave"; xml: string }
  | { event: "export"; data: string; xml: string }
  | { event: "lunedo-gliffy-converted" }
  | { event: "lunedo-gliffy-failed" };

export function drawioUrl(language: string): string {
  const query = new URLSearchParams({
    embed: "1",
    proto: "json",
    spin: "1",
    lockdown: "1",
    stealth: "1",
    pwa: "0",
    plugins: "0",
    noSaveBtn: "1",
    noExitBtn: "1",
    saveAndExit: "0",
    splash: "0",
    libraries: "1",
    lang: drawioLanguage(language),
  });
  return `${DRAWIO_PATH}index.html?${query.toString()}`;
}

export function parseDrawioMessage(data: unknown): DrawioEvent | null {
  if (typeof data !== "string" || data.length === 0 || data[0] !== "{") return null;
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (message.event) {
    case "init":
    case "load":
    case "lunedo-gliffy-converted":
    case "lunedo-gliffy-failed":
      return { event: message.event };
    case "autosave":
      return typeof message.xml === "string" ? { event: "autosave", xml: message.xml } : null;
    case "export":
      return typeof message.data === "string" && typeof message.xml === "string"
        ? { event: "export", data: message.data, xml: message.xml }
        : null;
    default:
      return null;
  }
}

export function loadMessage(xml: string, title: string): string {
  return JSON.stringify({ action: "load", xml, title, autosave: 1, modified: "unsavedChanges" });
}

export function exportMessage(): string {
  return JSON.stringify({
    action: "export",
    format: "svg",
    embedImages: true,
    border: 8,
    background: "#ffffff",
  });
}

export function svgFromDataUrl(data: string): string {
  const base64 = "data:image/svg+xml;base64,";
  if (data.startsWith(base64)) {
    const binary = atob(data.slice(base64.length));
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
  }
  const comma = data.indexOf(",");
  if (data.startsWith("data:image/svg+xml") && comma > 0) return decodeURIComponent(data.slice(comma + 1));
  throw new Error("draw.io did not return an SVG image");
}
