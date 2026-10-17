import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DiagramRejectedError, labelText, MAX_DRAWIO_BYTES, sanitizeDrawio } from "./drawio.js";

function compress(xml: string): string {
  return deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString("base64");
}

describe("sanitizeDrawio", () => {
  it("keeps cells, styles with embedded images and page links, and collects the label text", () => {
    const { xml, text } = sanitizeDrawio(
      `<mxfile host="Confluence"><diagram id="a" name="Netz"><mxGraphModel dx="800"><root><mxCell id="0"/>` +
        `<mxCell id="2" value="&lt;b&gt;Core&lt;/b&gt;&lt;br&gt;switch &amp;amp; router" style="shape=image;image=data:image/png,iVBORw0KGgo=;" vertex="1" parent="0"><mxGeometry width="10" height="10" as="geometry"/></mxCell>` +
        `<UserObject id="3" label="Wiki" link="https://wiki.example.org/x"><mxCell vertex="1" parent="0"/></UserObject>` +
        `<object id="4" label="Page two" link="data:page/id,p2"><mxCell vertex="1" parent="0"/></object>` +
        `</root></mxGraphModel></diagram></mxfile>`,
    );
    expect(xml).toContain("image=data:image/png,iVBORw0KGgo=");
    expect(xml).toContain('link="https://wiki.example.org/x"');
    expect(xml).toContain('link="data:page/id,p2"');
    expect(text).toBe("Core\nswitch & router\nWiki\nPage two");
  });

  it("stores compressed pages uncompressed", () => {
    const { xml, text } = sanitizeDrawio(
      `<mxfile><diagram name="p">${compress('<mxGraphModel><root><mxCell id="0" value="Packed"/></root></mxGraphModel>')}</diagram></mxfile>`,
    );
    expect(xml).toBe(
      '<mxfile><diagram name="p"><mxGraphModel><root><mxCell id="0" value="Packed"></mxCell></root></mxGraphModel></diagram></mxfile>',
    );
    expect(text).toBe("Packed");
  });

  it("drops event handlers, script links and active data", () => {
    const { xml } = sanitizeDrawio(
      `<mxGraphModel><root><mxCell id="0" onmouseover="x()" link="javascript:alert(1)" style="link=vbscript:x" tooltip="data:text/html,y"/></root></mxGraphModel>`,
    );
    expect(xml).toBe('<mxGraphModel><root><mxCell id="0"></mxCell></root></mxGraphModel>');
  });

  it("refuses other documents, entities, unknown elements, deep nesting and oversized files", () => {
    for (const input of [
      "<svg/>",
      '<!DOCTYPE mxfile [<!ENTITY a "x">]><mxfile>&a;</mxfile>',
      '<mxfile><foreignObject xmlns="http://www.w3.org/2000/svg"/></mxfile>',
      `<mxfile><diagram>${"x".repeat(20)}</diagram></mxfile>`,
      `<mxfile>${"<Array>".repeat(70)}${"</Array>".repeat(70)}</mxfile>`,
      `<mxfile>${" ".repeat(MAX_DRAWIO_BYTES)}</mxfile>`,
      "<mxfile><root>",
    ]) {
      expect(() => sanitizeDrawio(input), input.slice(0, 40)).toThrow(DiagramRejectedError);
    }
  });
});

describe("labelText", () => {
  it("turns HTML labels into lines of plain text", () => {
    expect(labelText("<div>One</div><div>Two&nbsp;&#x41;&#66;</div>")).toBe("One\nTwo AB");
  });
});
