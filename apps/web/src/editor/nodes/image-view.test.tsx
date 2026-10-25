import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";
import { initI18n } from "../../i18n/index.js";
import { renderWithProviders } from "../../testing/render.js";
import { createEditorExtensions } from "../extensions/index.js";
import { resizedWidth } from "./image-view.js";

const IMAGE = "01929b1e-0000-7000-8000-0000000000e1";

describe("resizing an image", () => {
  it("keeps the width between 10 and 100 percent and grows twice as fast when centered", () => {
    const base = { startWidth: 300, containerWidth: 600, corner: "bottom-right" as const };
    expect(resizedWidth({ ...base, deltaX: 60, align: "left" })).toBe(60);
    expect(resizedWidth({ ...base, deltaX: 60, align: "center" })).toBe(70);
    expect(resizedWidth({ ...base, deltaX: 60, align: "left", corner: "top-left" })).toBe(40);
    expect(resizedWidth({ ...base, deltaX: 900, align: "left" })).toBe(100);
    expect(resizedWidth({ ...base, deltaX: -900, align: "left" })).toBe(10);
  });
});

describe("the image bar", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  async function open(attrs: Record<string, unknown> = {}) {
    const i18n = await initI18n(["en"]);
    editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
          {
            type: "image",
            attrs: { attachmentId: IMAGE, alt: "Rack", width: null, align: "center", ...attrs },
          },
        ],
      },
    });
    const current = editor;
    await renderWithProviders(<EditorContent editor={current} />);
    act(() => {
      current.commands.focus();
      current.commands.setNodeSelection(current.state.doc.child(0).nodeSize);
    });
    return current;
  }

  function image(current: Editor) {
    return current.state.doc.child(1).attrs;
  }

  it("sets size, alignment and frame from its buttons", async () => {
    const current = await open();
    const bar = await screen.findByRole("toolbar", { name: "Image" });
    fireEvent.click(within(bar).getByRole("button", { name: "Medium, 50 % wide" }));
    expect(image(current).width).toBe(50);
    await waitFor(() =>
      expect(
        within(screen.getByRole("toolbar", { name: "Image" }))
          .getByRole("button", { name: "Medium, 50 % wide" })
          .getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Image" })).getByRole("button", { name: "Align right" }),
    );
    expect(image(current).align).toBe("right");
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Image" })).getByRole("button", { name: "Frame" }),
    );
    expect(image(current).frame).toBe(true);
    fireEvent.click(
      within(screen.getByRole("toolbar", { name: "Image" })).getByRole("button", { name: "Full width" }),
    );
    expect(image(current).width).toBe(100);
  });

  it("is reached with Tab from the selected image and removes the image", async () => {
    const current = await open({ width: 75 });
    const bar = await screen.findByRole("toolbar", { name: "Image" });
    fireEvent.keyDown(current.view.dom, { key: "Tab" });
    expect(document.activeElement).toBe(within(bar).getAllByRole("button")[0]);
    fireEvent.click(within(bar).getByRole("button", { name: "Remove image" }));
    const types: string[] = [];
    current.state.doc.forEach((node) => {
      types.push(node.type.name);
    });
    expect(types).not.toContain("image");
  });

  it("changes the alternative text", async () => {
    const current = await open();
    const bar = await screen.findByRole("toolbar", { name: "Image" });
    fireEvent.click(within(bar).getByRole("button", { name: "Alternative text" }));
    const dialog = await screen.findByRole("dialog", { name: "Alternative text" });
    const input = within(dialog).getByRole("textbox", { name: "Alternative text" });
    fireEvent.change(input, { target: { value: "Server rack in room 3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(image(current).alt).toBe("Server rack in room 3");
  });
});
