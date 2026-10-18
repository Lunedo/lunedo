import { buffer } from "node:stream/consumers";
import { modules, type RenderContext, renderWord, type WordBlock } from "@pagehall/editor-schema";
import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { defaultExportOptions, type ExportOptions } from "./options.js";
import {
  SAMPLE_FILE,
  SAMPLE_IMAGE,
  SAMPLE_PAGE,
  SAMPLE_PERSON,
  SAMPLE_TOPIC,
  sampleDocument,
  sampleTypes,
} from "./sample-document.testing.js";
import { exportTexts } from "./texts.js";
import { imageInfo, type WordDocument, type WordPage, wordDocument } from "./word.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEElEQVR4nGP4z8DwnwEIAA/2Av7f8DbHAAAAAElFTkSuQmCC",
  "base64",
);

async function entry(data: Buffer, name: string): Promise<string> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(data, { lazyEntries: true }, (error, opened) =>
      error ? reject(error) : resolve(opened),
    ),
  );
  return new Promise<string>((resolve, reject) => {
    zip.on("entry", (found: yauzl.Entry) => {
      if (found.fileName !== name) {
        zip.readEntry();
        return;
      }
      zip.openReadStream(found, (error, stream) => {
        if (error) return reject(error);
        buffer(stream).then((content) => resolve(content.toString("utf8")), reject);
      });
    });
    zip.on("end", () => reject(new Error(`${name} is missing`)));
    zip.readEntry();
  });
}

const context: RenderContext = {
  mention: (id) => (id === SAMPLE_PERSON ? { name: "Anna Berger" } : null),
  topic: (id) => (id === SAMPLE_TOPIC ? { title: "Budget" } : null),
  pageLink: (link) =>
    link.pageId === SAMPLE_PAGE
      ? {
          href: `https://wiki.example.org/spaces/IT/pages/${SAMPLE_PAGE}`,
          title: "Device naming",
          accessible: true,
        }
      : null,
  attachment: (id) => ({ href: `https://wiki.example.org/api/v1/attachments/${id}/content` }),
  attachmentList: () => [{ id: SAMPLE_FILE, name: "plan.pdf", size: 49_152 }],
  childPages: () => [{ title: "Vienna", href: "https://wiki.example.org/spaces/IT/pages/x", children: [] }],
  pageReport: () => [],
  decisionReport: () => [],
  taskReport: () => [],
  taskStatus: () => true,
};

function page(blocks: readonly WordBlock[], overrides: Partial<WordPage> = {}): WordPage {
  return {
    id: SAMPLE_PAGE,
    depth: 0,
    title: "Standort Graz",
    path: ["IT", "Network"],
    meta: ["Anna Berger · Published version 8 of 12 Oct 2026"],
    blocks,
    comments: [],
    ...overrides,
  };
}

function document(pages: WordPage[], options: Partial<ExportOptions> = {}): WordDocument {
  return {
    title: pages.length === 1 ? (pages[0]?.title ?? "") : "Network",
    path: ["IT"],
    exported: "Exported on 16 Oct 2026 by Anna Weber",
    options: { ...defaultExportOptions, ...options },
    texts: exportTexts("en"),
    pages,
    attachments: [{ name: "plan.pdf", page: "Standort Graz", size: "48 KB" }],
    image: async (id) => {
      if (id !== SAMPLE_IMAGE) return null;
      const info = imageInfo(PNG);
      return info ? { ...info, data: PNG } : null;
    },
    leftOut: () => false,
  };
}

async function html(data: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml(
    { buffer: data },
    { styleMap: ["p[style-name='Code'] => pre:separator('\\n')"] },
  );
  return result.value;
}

describe("Word documents", () => {
  it("uses a sample document with every node and mark of the editor schema", () => {
    const used = sampleTypes(sampleDocument());
    const missing = [...modules.nodes(), ...modules.marks()]
      .map((definition) => definition.name)
      .filter((name) => !used.has(name));
    expect(missing).toEqual([]);
  });

  it("writes every module of the sample document", async () => {
    const blocks = renderWord(sampleDocument(), context);
    const data = await wordDocument(document([page(blocks)], { comments: true }));
    const output = await html(data);
    expect(output).toMatch(/<h1><a id="_Toc\d+"><\/a>Network guide<\/h1>/);
    expect(output).toMatch(/<h2><a id="_Toc\d+"><\/a>Sites<\/h2>/);
    expect(output).toMatch(/<th colspan="2"><p>Site<\/p><\/th>/);
    expect(output).toMatch(/<td rowspan="2"><p>Graz<\/p><\/td>/);
    expect(output).toContain("<pre>wg-quick up wg0<br />wg show</pre>");
    expect(output).toContain('<a href="https://www.wireguard.com"> WireGuard</a>');
    expect(output).toContain(
      `<a href="https://wiki.example.org/spaces/IT/pages/${SAMPLE_PAGE}">Device naming</a>`,
    );
    expect(output).toContain('<img alt="Rack" src="data:image/png;base64,');
    expect(output).toContain(
      `<a href="https://wiki.example.org/api/v1/attachments/${SAMPLE_FILE}/content">plan.pdf</a>`,
    );
    expect(output).toContain("@Anna Berger");
    expect(output).toContain("DONE");
    expect(output).toContain("☑ Order cables @Anna Berger · 2026-10-20");
    expect(output).toContain("Mind the gap");
    expect(output).toContain("Topic news");
    expect(output).toContain("Unsupported macro: jira");
    expect(output).toContain("<li>Switches<ol><li>Core</li></ol></li>");
    const xml = await entry(data, "word/document.xml");
    expect(xml).not.toContain("cannot be shown in this format");
    expect(xml).toContain("TOC \\h \\o &quot;1-3&quot;");
  });

  it("writes the title block, contents, header and footer with page numbers", async () => {
    const data = await wordDocument(document([page([])]));
    const output = await html(data);
    expect(output).toContain("IT › Network");
    expect(output).toContain("Standort Graz");
    expect(output).toContain("Anna Berger · Published version 8 of 12 Oct 2026");
    expect(output).toContain("Appendix: attachments");
    const footer = await entry(data, "word/footer1.xml");
    expect(footer).toContain("Exported on 16 Oct 2026 by Anna Weber");
    expect(footer).toContain("PAGE");
    expect(footer).toContain("NUMPAGES");
    const header = await entry(data, "word/header1.xml");
    expect(header).toContain("IT › Standort Graz");
  });

  it("sets the paper size and orientation", async () => {
    const a4 = await entry(await wordDocument(document([page([])])), "word/document.xml");
    expect(a4).toMatch(/<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"\/>/);
    const letter = await entry(
      await wordDocument(document([page([])], { paper: "letter", orientation: "landscape" })),
      "word/document.xml",
    );
    expect(letter).toMatch(/<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"\/>/);
  });

  it("puts every page on its own page with its title as a heading and shifts its headings", async () => {
    const graz = renderWord(
      {
        type: "doc",
        content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Uplink" }] }],
      },
      context,
    );
    const data = await wordDocument(document([page(graz), page([], { id: "b", title: "Vienna", depth: 1 })]));
    const output = await html(data);
    expect(output).toMatch(/<h1><a id="_Toc\d+"><\/a>Standort Graz<\/h1>/);
    expect(output).toMatch(/<h2><a id="_Toc\d+"><\/a>Uplink<\/h2>/);
    expect(output).toMatch(/<h1><a id="_Toc\d+"><\/a>Vienna<\/h1>/);
    const xml = await entry(data, "word/document.xml");
    expect(xml.match(/<w:pageBreakBefore\/>/g)?.length).toBe(3);
  });

  it("leaves out comments and the appendix unless asked for", async () => {
    const comment = {
      quote: "uplink",
      author: "Lukas Hofer",
      date: "12 Oct 2026",
      body: [
        { type: "paragraph" as const, content: [{ type: "text" as const, text: "Is this 10G?", style: {} }] },
      ],
      replies: [],
    };
    const withComments = await html(
      await wordDocument(document([page([], { comments: [comment] })], { comments: true })),
    );
    expect(withComments).toContain("Comments");
    expect(withComments).toContain("On “uplink”");
    expect(withComments).toContain("Is this 10G?");
    const without = await html(
      await wordDocument(
        document([page([], { comments: [comment] })], { comments: false, attachments: false }),
      ),
    );
    expect(without).not.toContain("Is this 10G?");
    expect(without).not.toContain("Appendix: attachments");
  });

  it("links an image it cannot embed", async () => {
    const output = await html(
      await wordDocument(
        document([
          page([
            {
              type: "image",
              attachmentId: "01929b1e-0000-7000-8000-00000000ffff",
              href: "https://wiki.example.org/api/v1/attachments/x/content",
              alt: "Diagram",
              width: null,
              align: "center",
            },
          ]),
        ]),
      ),
    );
    expect(output).toContain(
      '<a href="https://wiki.example.org/api/v1/attachments/x/content"><em>Diagram</em></a>',
    );
    expect(output).not.toContain("<img");
  });
});

describe("image sizes", () => {
  it("reads the size of PNG, GIF and JPEG images", () => {
    expect(imageInfo(PNG)).toEqual({ type: "png", width: 2, height: 1 });
    const gif = Buffer.from("R0lGODlhAwACAIAAAP///wAAACwAAAAAAwACAAACAoRRADs=", "base64");
    expect(imageInfo(gif)).toEqual({ type: "gif", width: 3, height: 2 });
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x05, 0x00, 0x07,
      0x03,
    ]);
    expect(imageInfo(jpeg)).toEqual({ type: "jpg", width: 7, height: 5 });
    expect(imageInfo(Buffer.from("not an image"))).toBeNull();
  });

  it("reads the size of SVG images from their size or view box", () => {
    expect(
      imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640px" height="480"></svg>')),
    ).toEqual({ type: "svg", width: 640, height: 480 });
    expect(imageInfo(Buffer.from('<?xml version="1.0"?><svg viewBox="0 0 1200.5 300"></svg>'))).toEqual({
      type: "svg",
      width: 1201,
      height: 300,
    });
    expect(imageInfo(Buffer.from('<svg width="100%"></svg>'))).toEqual({
      type: "svg",
      width: 800,
      height: 600,
    });
  });

  it("embeds SVG images with a fallback for older Word versions", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"></svg>');
    const data = await wordDocument({
      ...document([
        page([
          {
            type: "image",
            attachmentId: SAMPLE_IMAGE,
            href: null,
            alt: "Board",
            width: null,
            align: "center",
          },
        ]),
      ]),
      image: async () => {
        const info = imageInfo(svg);
        return info ? { ...info, data: svg } : null;
      },
    });
    expect(await entry(data, "word/document.xml")).toContain("svgBlip");
    expect(await html(data)).toContain('<img alt="Board" src="data:image/png;base64,');
  });
});
