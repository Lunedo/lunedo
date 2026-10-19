import { describe, expect, it } from "vitest";
import {
  articleSections,
  type DocumentJson,
  emptySections,
  imageFramed,
  migrateDocument,
  renderHtml,
  validateDocument,
} from "./index.js";

const paragraph = (text?: string) =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };
const hint = (text: string) => ({ type: "paragraph", content: [{ type: "placeholder", attrs: { text } }] });
const image = (frame?: boolean | null) => ({
  type: "image",
  attrs: { attachmentId: "01929b1e-0000-7000-8000-000000000001", ...(frame === undefined ? {} : { frame }) },
});
const section = (key: string, title: string, ...content: object[]) => ({
  type: "section",
  attrs: { key, title },
  content: content.length > 0 ? content : [paragraph()],
});

describe("article sections", () => {
  const document = {
    type: "doc",
    content: [
      paragraph("Intro"),
      section("summary", "What this is about", paragraph("VPN for remote staff.")),
      section("prerequisites", "Before you start", hint("List what is needed")),
      section("steps", "Steps", image()),
      section("help", "Did it not work?", {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph("  ")] }],
      }),
    ],
  } as DocumentJson;

  it("lists the sections in document order with their content", () => {
    expect(articleSections(document).map((found) => [found.key, found.title, found.icon])).toEqual([
      ["summary", "What this is about", null],
      ["prerequisites", "Before you start", null],
      ["steps", "Steps", null],
      ["help", "Did it not work?", null],
    ]);
  });

  it("counts text and media as content, hints, empty lists and missing sections as empty", () => {
    expect(emptySections(document, ["summary", "prerequisites", "steps", "help", "cause"])).toEqual([
      "prerequisites",
      "help",
      "cause",
    ]);
  });
});

describe("image frames", () => {
  it("frames images by default only in the step, symptom and resolution sections", () => {
    expect(imageFramed(null, "steps")).toBe(true);
    expect(imageFramed(null, "symptom")).toBe(true);
    expect(imageFramed(null, "resolution")).toBe(true);
    expect(imageFramed(null, "cause")).toBe(false);
    expect(imageFramed(null, null)).toBe(false);
  });

  it("lets every image switch the frame on or off", () => {
    expect(imageFramed(false, "steps")).toBe(false);
    expect(imageFramed(true, null)).toBe(true);
  });

  it("keeps images of older documents on the default of their section", () => {
    const old = { type: "doc", content: [image()] } as DocumentJson;
    const result = validateDocument(migrateDocument(old, 11));
    expect(result.ok && result.document.content?.[0]?.attrs?.frame).toBeNull();
  });

  it("rejects frame values that are not on, off or the default", () => {
    expect(validateDocument({ type: "doc", content: [{ ...image(), attrs: { frame: "yes" } }] }).ok).toBe(
      false,
    );
  });

  it("marks framed sections and explicit frames in the rendered page", () => {
    const html = renderHtml({
      type: "doc",
      content: [section("steps", "Steps", image(false)), section("cause", "Cause", image(true))],
    });
    expect(html).toContain('data-section="steps" data-framed="true"');
    expect(html).toContain('data-frame="off"');
    expect(html).toContain('data-frame="on"');
    expect(html).not.toContain('data-section="cause" data-framed');
  });
});

describe("section icons", () => {
  it("accepts Lucide icon names and renders them", () => {
    const document = {
      type: "doc",
      content: [
        {
          ...section("symptom", "What you see", paragraph("x")),
          attrs: { key: "symptom", title: "What you see", icon: "eye" },
        },
      ],
    };
    expect(validateDocument(document).ok).toBe(true);
    expect(renderHtml(document)).toContain('data-icon="eye"');
  });

  it("rejects icon values that are not icon names", () => {
    for (const icon of ["Eye", "<script>", "eye--open", "a".repeat(61)]) {
      const document = {
        type: "doc",
        content: [{ type: "section", attrs: { key: "symptom", icon }, content: [paragraph()] }],
      };
      expect(validateDocument(document).ok).toBe(false);
    }
  });
});
