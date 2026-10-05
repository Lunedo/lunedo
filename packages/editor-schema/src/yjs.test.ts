import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { loadFixtures } from "./fixtures.testing.js";
import {
  type DocumentJson,
  documentSize,
  editorSchemaVersion,
  type NodeJson,
  validateDocument,
} from "./index.js";
import { applyDocument, documentFromYDoc, Y_FRAGMENT, yDocFromDocument } from "./yjs.js";

function normalized(doc: unknown): DocumentJson {
  const result = validateDocument(doc);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.document;
}

function sync(left: Y.Doc, right: Y.Doc): void {
  Y.applyUpdate(right, Y.encodeStateAsUpdate(left, Y.encodeStateVector(right)));
  Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
}

function paragraph(text: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe("Yjs conversion", () => {
  for (const { name, document } of loadFixtures(editorSchemaVersion)) {
    it(`round-trips ${name}`, () => {
      const ydoc = yDocFromDocument(document);
      expect(normalized(documentFromYDoc(ydoc))).toEqual(normalized(document));
    });
  }

  it("applies a document with minimal changes and keeps concurrent edits", () => {
    const left = yDocFromDocument({ type: "doc", content: [paragraph("First"), paragraph("Second")] });
    const right = new Y.Doc();
    sync(left, right);

    applyDocument(left, { type: "doc", content: [paragraph("First"), paragraph("Second, changed")] }, "api");
    const rightText = right.getXmlFragment(Y_FRAGMENT).get(0) as Y.XmlElement;
    (rightText.get(0) as Y.XmlText).insert(0, "Very ");
    sync(left, right);

    const leftResult = normalized(documentFromYDoc(left));
    expect(leftResult).toEqual(normalized(documentFromYDoc(right)));
    expect(leftResult.content?.map((block) => block.content?.[0]?.text)).toEqual([
      "Very First",
      "Second, changed",
    ]);
  });

  it("passes the origin to the transaction", () => {
    const ydoc = yDocFromDocument({ type: "doc", content: [paragraph("x")] });
    const origins: unknown[] = [];
    ydoc.on("afterTransaction", (transaction) => origins.push(transaction.origin));
    applyDocument(ydoc, { type: "doc", content: [paragraph("y")] }, "api");
    expect(origins).toEqual(["api"]);
  });

  it("refuses to write invalid documents", () => {
    expect(() => yDocFromDocument({ type: "doc", content: [{ type: "script" }] })).toThrow(
      /Invalid document/,
    );
    expect(() => applyDocument(new Y.Doc(), { type: "doc" })).toThrow(/Invalid document/);
  });

  it("exposes unknown nodes and attributes written into a Y document to validation", () => {
    const ydoc = yDocFromDocument({ type: "doc", content: [paragraph("x")] });
    const fragment = ydoc.getXmlFragment(Y_FRAGMENT);
    const script = new Y.XmlElement("script");
    fragment.insert(1, [script]);
    expect(validateDocument(documentFromYDoc(ydoc)).ok).toBe(false);

    const other = yDocFromDocument({ type: "doc", content: [paragraph("x")] });
    (other.getXmlFragment(Y_FRAGMENT).get(0) as Y.XmlElement).setAttribute("onclick", "alert(1)");
    const result = validateDocument(documentFromYDoc(other));
    expect(result.ok ? [] : result.problems.map((problem) => problem.code)).toEqual(["unknownAttribute"]);
  });

  it("converts and validates a 200 KB document quickly", () => {
    const blocks: NodeJson[] = [];
    while (documentSize({ type: "doc", content: blocks }) < 200 * 1024) {
      blocks.push(
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: `Section ${blocks.length}` }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Staff working from home connect through " },
            { type: "text", text: "WireGuard", marks: [{ type: "bold" }] },
            { type: "text", text: ". This runbook covers new devices and the usual problems." },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph("Install the client from the portal.")] },
            { type: "listItem", content: [paragraph("Create a tunnel and copy its public key.")] },
          ],
        },
      );
    }
    const ydoc = yDocFromDocument({ type: "doc", content: blocks });
    const runs: number[] = [];
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      expect(validateDocument(documentFromYDoc(ydoc)).ok).toBe(true);
      runs.push(performance.now() - started);
    }
    expect(Math.min(...runs)).toBeLessThan(1000);
  });
});
