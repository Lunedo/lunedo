import { describe, expect, it } from "vitest";
import { MAX_PREVIEW_BYTES, SvgRejectedError, sanitizeDiagramSvg, sanitizeSvg } from "./svg.js";

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("sanitizeSvg", () => {
  it("keeps the shapes, text, fonts and embedded images of an exported drawing", () => {
    const input = `<?xml version="1.0"?><svg ${NS} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" width="100" height="50">
      <!-- comment --><metadata>scene</metadata>
      <defs><style class="style-fonts">@font-face { font-family: Excalifont; src: url(data:font/woff2;base64,d09GMgAB); }</style>
      <symbol id="image-1"><image href="${PNG}" width="10" height="10"/></symbol></defs>
      <rect x="0" y="0" width="100" height="50" fill="#ffffff"/>
      <g transform="translate(10 10)" stroke-linecap="round"><path d="M0 0 L10 10" stroke="#1e1e1e" fill="url(#hatch)"/></g>
      <text x="5" y="20" font-family="Excalifont" style="white-space: pre;">Uplink &amp; Core &lt;10G&gt;</text>
      <use xlink:href="#image-1" width="10" height="10"/>
    </svg>`;
    const output = sanitizeSvg(input);
    expect(output.startsWith(`<svg ${NS} viewBox="0 0 100 50" width="100" height="50">`)).toBe(true);
    expect(output).toContain("@font-face");
    expect(output).toContain(`<image href="${PNG}" width="10" height="10">`);
    expect(output).toContain('<use href="#image-1"');
    expect(output).toContain("Uplink &amp; Core &lt;10G&gt;");
    expect(output).toContain('fill="url(#hatch)"');
    expect(output).not.toContain("metadata");
    expect(output).not.toContain("comment");
  });

  it("removes scripts, event handlers, foreign content and animations", () => {
    const output = sanitizeSvg(
      `<svg ${NS} onload="alert(1)"><script>alert(1)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(2)</script></div></foreignObject>
       <rect onclick="alert(3)" width="1" height="1"><set attributeName="onmouseover" to="alert(4)"/><animate attributeName="href" to="javascript:alert(5)"/></rect>
       <a href="javascript:alert(6)"><text>link</text></a><iframe src="https://evil.example"/></svg>`,
    );
    expect(output).not.toMatch(/alert|script|onload|onclick|foreignObject|animate|<set|<a |iframe|link/);
    expect(output).toContain('<rect width="1" height="1">');
  });

  it("removes every reference to external resources", () => {
    const output = sanitizeSvg(
      `<svg ${NS}><image href="https://evil.example/track.png"/><image href="data:image/svg+xml;base64,PHN2Zz4="/>
       <use href="https://evil.example/sprite.svg#a"/><use href="data:image/svg+xml,&lt;svg&gt;"/>
       <rect fill="url(https://evil.example/x)" style="background:url(https://evil.example/y)" width="1" height="1"/>
       <style>@import url(https://evil.example/a.css); rect { fill: red }</style>
       <style>@font-face { src: url(https://evil.example/font.woff2) }</style>
       <style>.a { background: url( "data:text/html,x" ) }</style>
       <rect style="fill: expression(alert(1))" width="2" height="2"/></svg>`,
    );
    expect(output).not.toContain("evil.example");
    expect(output).not.toContain("<style>");
    expect(output).not.toContain("data:image/svg");
    expect(output).not.toContain("expression");
    expect(output).toContain("<image></image>");
    expect(output).toContain('<rect width="2" height="2">');
  });

  it("refuses documents that are not SVG, declare entities or are too large", () => {
    expect(() => sanitizeSvg('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>')).toThrow(
      SvgRejectedError,
    );
    expect(() => sanitizeSvg(`<rect ${NS}/>`)).toThrow(SvgRejectedError);
    expect(() => sanitizeSvg(`<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg ${NS}><text>&a;</text></svg>`)).toThrow(
      SvgRejectedError,
    );
    expect(() => sanitizeSvg(`<svg ${NS}><rect`)).toThrow(SvgRejectedError);
    expect(() => sanitizeSvg(`<svg ${NS}>${" ".repeat(MAX_PREVIEW_BYTES)}</svg>`)).toThrow(SvgRejectedError);
    const deep = `${"<g>".repeat(100)}${"</g>".repeat(100)}`;
    expect(() => sanitizeSvg(`<svg ${NS}>${deep}</svg>`)).toThrow(SvgRejectedError);
  });
});

describe("sanitizeDiagramSvg", () => {
  it("keeps arrowheads, styles and shadows of Mermaid and PlantUML diagrams and collects their text", () => {
    const result = sanitizeDiagramSvg(
      `<svg ${NS} width="300" height="120" viewBox="0 0 300 120"><style>#m .node rect{fill:#ececff;stroke:#9370db}</style>
        <defs><marker id="m_arrow" refX="5" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z"/></marker>
        <filter id="f1" filterUnits="userSpaceOnUse"><feGaussianBlur stdDeviation="2" result="b"/><feOffset dx="2" dy="2" in="b"/></filter></defs>
        <g class="node" filter="url(#f1)"><rect width="80" height="40"/><text x="5" y="20" textLength="60" lengthAdjust="spacing"><tspan>Incident</tspan> <tspan>reported</tspan></text></g>
        <path d="M80 20L200 20" marker-end="url(#m_arrow)"/><text>Ticket</text></svg>`,
      MAX_PREVIEW_BYTES,
    );
    expect(result.svg).toContain('marker-end="url(#m_arrow)"');
    expect(result.svg).toContain("<feGaussianBlur");
    expect(result.svg).toContain('filter="url(#f1)"');
    expect(result.svg).toContain('textLength="60"');
    expect(result.svg).toContain("#m .node rect");
    expect(result).toMatchObject({ text: "Incident reported\nTicket", width: 300, height: 120 });
  });

  it("keeps simple formatted labels of draw.io and drops everything active in them", () => {
    const result = sanitizeDiagramSvg(
      `<svg ${NS} viewBox="0 0 50 40"><switch><foreignObject requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility" width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; color: rgb(0, 0, 0);"><div><b>Core</b><br/>switch<iframe src="https://evil.example"/></div></div>
        </foreignObject><text>Core switch</text></switch><a href="https://example.com"><rect width="1" height="1"/></a>
        <image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>`,
      MAX_PREVIEW_BYTES,
    );
    expect(result.svg).toContain(
      '<div xmlns="http://www.w3.org/1999/xhtml" style="display: flex; color: rgb(0, 0, 0);">',
    );
    expect(result.svg).toContain("<b>Core</b><br/>switch");
    expect(result.svg).toContain('<rect width="1" height="1">');
    expect(result.svg).toContain('href="data:image/svg+xml;base64,PHN2Zy8+"');
    expect(result.svg).not.toMatch(/iframe|evil|example\.com|<a /);
    expect(result).toMatchObject({ width: 50, height: 40 });
    expect(result.text.split("\n")).toEqual(["Core", "switch", "Core switch"]);
  });

  it("applies the given size limit", () => {
    expect(() => sanitizeDiagramSvg(`<svg ${NS}>${" ".repeat(100)}</svg>`, 50)).toThrow(SvgRejectedError);
  });
});
