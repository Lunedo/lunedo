import { describe, expect, it } from "vitest";
import {
  drawioUrl,
  exportMessage,
  loadMessage,
  parseDrawioMessage,
  svgFromDataUrl,
} from "./drawio-protocol.js";
import { DRAWIO_PATH } from "./drawio-version.js";

describe("draw.io embed protocol", () => {
  it("opens the shipped editor in embed mode without cloud services, plugins or its own buttons", () => {
    const url = new URL(drawioUrl("de-AT"), "https://wiki.example.org");
    expect(url.pathname).toBe(`${DRAWIO_PATH}index.html`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      embed: "1",
      proto: "json",
      lockdown: "1",
      stealth: "1",
      plugins: "0",
      pwa: "0",
      noSaveBtn: "1",
      noExitBtn: "1",
      lang: "de",
    });
    expect(new URL(drawioUrl("fr"), "https://x.example").searchParams.get("lang")).toBe("en");
  });

  it("reads only the events Pagehall handles", () => {
    expect(parseDrawioMessage('{"event":"init"}')).toEqual({ event: "init" });
    expect(parseDrawioMessage('{"event":"autosave","xml":"<mxfile/>"}')).toEqual({
      event: "autosave",
      xml: "<mxfile/>",
    });
    expect(
      parseDrawioMessage('{"event":"export","data":"data:image/svg+xml;base64,PHN2Zy8+","xml":"<mxfile/>"}'),
    ).toEqual({
      event: "export",
      data: "data:image/svg+xml;base64,PHN2Zy8+",
      xml: "<mxfile/>",
    });
    for (const data of [
      '{"event":"export","data":1}',
      '{"event":"exit"}',
      "not json",
      { event: "init" },
      "{bad",
    ]) {
      expect(parseDrawioMessage(data)).toBeNull();
    }
  });

  it("asks for an SVG with embedded images and loads with autosave", () => {
    expect(JSON.parse(exportMessage())).toMatchObject({ action: "export", format: "svg", embedImages: true });
    expect(JSON.parse(loadMessage("<mxfile/>", "Plan"))).toMatchObject({
      action: "load",
      xml: "<mxfile/>",
      autosave: 1,
    });
  });

  it("decodes the exported SVG, also with UTF-8 text", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Straße</text></svg>';
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(svg)));
    expect(svgFromDataUrl(`data:image/svg+xml;base64,${base64}`)).toBe(svg);
    expect(svgFromDataUrl(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`)).toBe(svg);
    expect(() => svgFromDataUrl("data:image/png;base64,AAAA")).toThrow();
  });
});
