import { describe, expect, it } from "vitest";
import { DEFAULT_XML_LIMITS, parseXml, parseXmlFragment, type XmlLimits, type XmlNode } from "./xml.js";

async function failure(xml: string, limits: Partial<XmlLimits> = {}): Promise<string> {
  try {
    await parseXml([xml], {}, { ...DEFAULT_XML_LIMITS, ...limits });
  } catch (error) {
    return (error as { code?: string }).code ?? "unknown";
  }
  return "none";
}

function textOf(node: XmlNode | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}

describe("XML reading", () => {
  it("decodes HTML character references in text and attributes but not in CDATA", async () => {
    const root = await parseXmlFragment(
      '<p title="Gr&ouml;&szlig;e &amp; more">&Uuml;ber &rarr; &#x1F600; &amp;lt;</p><x><![CDATA[&uuml; <b>]]></x>',
    );
    const [paragraph, cdata] = root.children as XmlNode[];
    expect(paragraph?.attributes.title).toBe("Größe & more");
    expect(textOf(paragraph as XmlNode)).toBe("Über → 😀 &lt;");
    expect(textOf(cdata as XmlNode)).toBe("&uuml; <b>");
  });

  it("refuses document type declarations and does not expand entities", async () => {
    const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>`;
    expect(await failure(laughs)).toBe("xmlDeclaration");
    const external = `<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><x>&xxe;</x>`;
    expect(await failure(external)).toBe("xmlDeclaration");
  });

  it("leaves unknown entity references as text", async () => {
    const root = await parseXmlFragment("<x>&xxe;&lol2;</x>");
    expect(textOf(root)).toBe("&xxe;&lol2;");
  });

  it("refuses nesting deeper than the limit", async () => {
    const deep = `${"<a>".repeat(50)}${"</a>".repeat(50)}`;
    expect(await failure(deep, { maxDepth: 40 })).toBe("xmlTooDeep");
    expect(await failure(deep, { maxDepth: 60 })).toBe("none");
  });

  it("refuses elements with more text than the limit", async () => {
    const big = `<body>${"x".repeat(5000)}</body>`;
    expect(await failure(big, { maxElementBytes: 1000 })).toBe("xmlElementTooLarge");
    expect(await failure(big, { maxElementBytes: 10_000 })).toBe("none");
  });

  it("refuses attributes larger than the limit", async () => {
    expect(await failure(`<a href="${"x".repeat(5000)}"/>`, { maxElementBytes: 1000 })).toBe(
      "xmlElementTooLarge",
    );
  });

  it("refuses a tag that never ends instead of buffering it", async () => {
    const endless = `<a ${"b".repeat(200_000)}`;
    expect(await failure(endless, { maxTokenBytes: 100_000, maxElementBytes: 10_000_000 })).toBe(
      "xmlElementTooLarge",
    );
  });

  it("reads the source as a stream", async () => {
    let yielded = 0;
    let firstEventAfter = -1;
    async function* source() {
      yield "<root>";
      for (let index = 0; index < 200; index += 1) {
        yielded += 1;
        yield `<object id="${index}">${"x".repeat(1000)}</object>`;
      }
      yield "</root>";
    }
    await parseXml(source(), {
      open(name) {
        if (name === "object" && firstEventAfter < 0) firstEventAfter = yielded;
      },
    });
    expect(firstEventAfter).toBeGreaterThan(0);
    expect(firstEventAfter).toBeLessThan(5);
  });
});
