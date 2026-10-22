import { validateDocument } from "@lunedo/editor-schema";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { schemaExtensions } from "../schema/extensions.js";
import { FindReplace, findKey, findMatches } from "./find-replace.js";
import { SchemaGuard } from "./guard.js";

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function create(html: string) {
  editor = new Editor({ extensions: [...schemaExtensions(), FindReplace, SchemaGuard], content: html });
  return editor;
}

describe("find and replace", () => {
  it("finds matches across marks and blocks, case-insensitively by default", () => {
    const current = create("<p>Alpha <strong>be</strong>ta alpha</p><h2>ALPHA</h2>");
    expect(findMatches(current.state.doc, "alpha")).toHaveLength(3);
    expect(findMatches(current.state.doc, "alpha", true)).toHaveLength(1);
    expect(findMatches(current.state.doc, "beta")).toHaveLength(1);
    expect(findMatches(current.state.doc, "")).toEqual([]);
  });

  it("moves between matches and selects the current one", () => {
    const current = create("<p>one two one two one</p>");
    current.commands.setFindQuery("one");
    expect(findKey.getState(current.state)?.matches).toHaveLength(3);
    expect(current.state.selection.from).toBe(1);
    current.commands.findNext();
    expect(findKey.getState(current.state)?.current).toBe(1);
    current.commands.findPrevious();
    current.commands.findPrevious();
    expect(findKey.getState(current.state)?.current).toBe(2);
  });

  it("replaces one match or all of them and keeps the document valid", () => {
    const current = create("<p>cat and cat and <em>cat</em></p>");
    current.commands.setFindQuery("cat");
    current.commands.replaceCurrent("dog");
    expect(current.getText()).toBe("dog and cat and cat");
    expect(findKey.getState(current.state)?.matches).toHaveLength(2);
    current.commands.replaceAll("bird");
    expect(current.getText()).toBe("dog and bird and bird");
    expect(validateDocument(current.getJSON()).ok).toBe(true);
    current.commands.clearFind();
    expect(findKey.getState(current.state)?.matches).toEqual([]);
  });
});

describe("schema guard", () => {
  it("refuses local changes that would put invalid attributes into the document", () => {
    const current = create("<p>Text</p>");
    const before = JSON.stringify(current.getJSON());
    current.commands.insertContent({ type: "status", attrs: { text: "", color: "neon" } });
    current.commands.insertContent({ type: "codeBlock", attrs: { language: "klingon" } });
    current.commands.setMark("link", { href: "javascript:alert(1)" });
    expect(JSON.stringify(current.getJSON())).toBe(before);
    current.commands.insertContent({ type: "status", attrs: { text: "Done", color: "green" } });
    expect(JSON.stringify(current.getJSON())).toContain('"text":"Done"');
  });
});
