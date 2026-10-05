import { validateDocument } from "@pagehall/editor-schema";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { schemaExtensions } from "../schema/extensions.js";
import { CleanPaste, cleanPastedHtml, looksLikeMarkdown, markdownToHtml } from "./paste.js";
import { pasteFixtures } from "./paste-fixtures.js";

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function paste(html: string) {
  editor = new Editor({ extensions: [...schemaExtensions(), CleanPaste], content: "<p></p>" });
  editor.view.pasteHTML(html);
  const json = editor.getJSON();
  const result = validateDocument(json);
  expect(result.ok ? [] : result.problems).toEqual([]);
  return JSON.stringify(json);
}

describe("clean pasting", () => {
  it("keeps the structure of a Word document and drops its markup", () => {
    const text = paste(pasteFixtures.word);
    expect(text).toContain('"type":"heading"');
    expect(text).toContain("Quarterly review");
    expect(text).toContain('"type":"bold"');
    expect(text).toContain('"type":"italic"');
    expect(text).toContain('"type":"underline"');
    expect(text).toContain('"type":"bulletList"');
    expect(text).toContain("Second point");
    expect(text).toContain('"type":"table"');
    expect(text).toContain("https://example.org/report");
    expect(text).not.toContain("file:///");
    expect(text).not.toMatch(/mso|Calibri|o:p|·|#C00000|FFFF00/i);
  });

  it("maps Google Docs styles to marks and drops colors, fonts and images", () => {
    const text = paste(pasteFixtures.googleDocs);
    expect(text).toContain('"type":"heading"');
    expect(text).toContain("Launch plan");
    expect(text).toContain('"type":"bold"');
    expect(text).toContain('"type":"italic"');
    expect(text).toContain('"type":"strike"');
    expect(text).toContain('"type":"bulletList"');
    expect(text).toContain("After the image");
    expect(text).not.toMatch(/docs-internal-guid|Arial|ff0000|googleusercontent|font-size/);
    const bold = JSON.parse(text).content?.[1]?.content?.[0];
    expect(bold?.text).toBe("Bold words");
  });

  it("drops scripts, styles, event handlers, frames and unknown elements from web pages", () => {
    const text = paste(pasteFixtures.webPage);
    expect(text).toContain("Install the client");
    expect(text).toContain("https://vendor.example/download");
    expect(text).toContain("Unknown element text");
    expect(text).toContain('"language":"bash"');
    expect(text).toContain("echo hi");
    expect(text).not.toMatch(
      /javascript:|alert|steal|track|onclick|onerror|onmouseover|display: none|evil\.example|custom-widget|secret|Comic|lime|not-a-uuid|neon/,
    );
    expect(text).not.toContain("notalanguage");
  });

  it("cleans the HTML before parsing", () => {
    const cleaned = cleanPastedHtml(
      '<p onclick="x()">A<o:p></o:p></p><script>bad()</script><!--[if mso]>x<![endif]-->',
    );
    expect(cleaned).toBe("<p>A</p>");
  });
});

describe("Markdown pasting", () => {
  it("recognizes Markdown and turns it into the matching blocks", () => {
    expect(looksLikeMarkdown("# Title\n\n- one\n- two")).toBe(true);
    expect(looksLikeMarkdown("Just a sentence.")).toBe(false);
    const html = markdownToHtml(
      "## Plan\n\n- [ ] open\n- [x] done\n\n1. first\n\n> quote\n\n```js\nlet a = 1;\n```\n\n**bold** and `code` and [link](https://example.org)",
    );
    const text = paste(html);
    expect(text).toContain('"type":"heading","attrs":{"level":2');
    expect(text).toContain('"type":"taskItem","attrs":{"checked":true');
    expect(text).toContain('"type":"orderedList"');
    expect(text).toContain('"type":"blockquote"');
    expect(text).toContain('"language":"javascript"');
    expect(text).toContain('"type":"code"');
    expect(text).toContain("https://example.org");
  });

  it("does not turn raw HTML in Markdown into elements", () => {
    const text = paste(markdownToHtml("# Hi\n\n<script>alert(1)</script> <b onclick=x>bold</b>"));
    expect(text).not.toContain('"type":"bold"');
    expect(text).toContain("alert(1)");
  });
});
