import { type DocumentJson, validateComment } from "@lunedo/editor-schema";
import { describe, expect, it } from "vitest";
import { threadAnchor, toCommentDocument, withoutThreads } from "./comment-document.js";
import { roleFor } from "./permissions.js";
import { parseUserList } from "./user-list.js";

const THREAD = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f0001";

describe("roleFor", () => {
  it.each([
    [["VIEWSPACE"], { role: "reader", status: "mapped", code: null }],
    [["VIEWSPACE", "EXPORTSPACE"], { role: "reader", status: "mapped", code: null }],
    [["VIEWSPACE", "COMMENT"], { role: "commenter", status: "mapped", code: null }],
    [["VIEWSPACE", "COMMENT", "REMOVECOMMENT"], { role: "commenter", status: "check", code: "narrowed" }],
    [["VIEWSPACE", "REMOVEPAGE"], { role: "reader", status: "check", code: "narrowed" }],
    [["VIEWSPACE", "CREATEATTACHMENT"], { role: "reader", status: "check", code: "narrowed" }],
    [["VIEWSPACE", "EDITSPACE"], { role: "editor", status: "check", code: "widened" }],
    [
      ["VIEWSPACE", "EDITBLOG", "REMOVEPAGE", "SETPAGEPERMISSIONS"],
      { role: "editor", status: "mapped", code: null },
    ],
    [
      ["VIEWSPACE", "EDITSPACE", "REMOVEPAGE", "SETPAGEPERMISSIONS", "COMMENT"],
      { role: "editor", status: "mapped", code: null },
    ],
    [["VIEWSPACE", "EDITSPACE", "SETSPACEPERMISSIONS"], { role: "admin", status: "mapped", code: null }],
    [["VIEWSPACE", "SETSPACEPERMISSIONS"], { role: "admin", status: "check", code: "widened" }],
    [["COMMENT", "EDITSPACE"], { role: null, status: "notTaken", code: "withoutView" }],
    [[], { role: null, status: "notTaken", code: "withoutView" }],
  ])("maps %j", (permissions, expected) => {
    expect(roleFor(new Set(permissions))).toEqual(expected);
  });
});

describe("parseUserList", () => {
  it("reads the export of the Atlassian administration with one row per group", async () => {
    const list = [
      "﻿Group id,Group name,User id,User name,email,User status",
      "g1,staff,557058:a,Anna Weber,anna@example.org,Active",
      "g2,admins,557058:a,Anna Weber,anna@example.org,Active",
      'g1,staff,557058:b,"Weber, Ben",,Active',
      "g1,staff,,Nobody,nobody@example.org,Active",
    ].join("\r\n");
    expect(await parseUserList(list)).toEqual([
      { externalId: "557058:a", name: "Anna Weber", email: "anna@example.org" },
      { externalId: "557058:b", name: "Weber, Ben", email: null },
    ]);
  });

  it("accepts other column names and refuses files without a user ID", async () => {
    expect(await parseUserList("Account ID,Display name,Email address\nx,Xavier,x@example.org")).toEqual([
      { externalId: "x", name: "Xavier", email: "x@example.org" },
    ]);
    await expect(parseUserList("name,email\nA,a@example.org")).rejects.toMatchObject({
      code: "userListInvalid",
    });
    await expect(parseUserList("")).rejects.toMatchObject({ code: "userListInvalid" });
    await expect(parseUserList("x".repeat(10 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: "userListTooLarge",
    });
  });
});

describe("comment documents", () => {
  const rich: DocumentJson = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text: "cell" }] }],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "red",
            marks: [{ type: "textColor", attrs: { color: "red" } }, { type: "bold" }],
          },
          { type: "emoji", attrs: { emoji: "🙂" } },
          { type: "mention", attrs: { id: THREAD } },
        ],
      },
      { type: "image", attrs: { attachmentId: THREAD } },
    ],
  } as DocumentJson;

  it("keeps text, lists, formatting and mentions and drops what comments cannot show", () => {
    const comment = toCommentDocument(rich);
    expect(validateComment(comment).ok).toBe(true);
    const text = JSON.stringify(comment);
    expect(text).toContain("Title");
    expect(text).toContain("cell");
    expect(text).toContain("🙂");
    expect(text).toContain('"mention"');
    expect(text).not.toContain("textColor");
    expect(text).not.toContain("table");
    expect(text).not.toContain("image");
  });

  it("puts the quoted text first when an inline comment lost its place", () => {
    const comment = toCommentDocument(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Why?" }] }] },
      "old text",
    );
    expect(comment.content?.[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "“old text”", marks: [{ type: "italic" }] }],
    });
  });

  it("gives an empty comment a placeholder text so that it stays valid", () => {
    expect(validateComment(toCommentDocument({ type: "doc", content: [] } as DocumentJson)).ok).toBe(true);
  });

  it("finds the anchor of a marked thread and removes marks of threads without one", () => {
    const marked: DocumentJson = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The " },
            {
              type: "text",
              text: "rollout",
              marks: [{ type: "inlineComment", attrs: { threadId: THREAD } }],
            },
            { type: "text", text: " window" },
          ],
        },
      ],
    } as DocumentJson;
    expect(threadAnchor(marked, THREAD)).toEqual({ exact: "rollout", prefix: "The ", suffix: " window" });
    expect(threadAnchor(marked, "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f0002")).toBeNull();
    expect(JSON.stringify(withoutThreads(marked, new Set([THREAD])))).not.toContain("inlineComment");
  });
});
