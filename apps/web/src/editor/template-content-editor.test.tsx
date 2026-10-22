import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/request.js";
import { renderWithProviders } from "../testing/render.js";
import { rememberReferences } from "./references.js";
import { TemplateContentEditor } from "./template-content-editor.js";

vi.mock("@tiptap/react", async (original) => ({
  ...(await original<typeof import("@tiptap/react")>()),
  useEditorState: () => [],
}));

type Node = { type?: string; content?: Node[] };

function images(document: unknown): number {
  const walk = (node: Node): number =>
    (node.type === "image" ? 1 : 0) + (node.content ?? []).reduce((sum, child) => sum + walk(child), 0);
  return walk(document as Node);
}

describe("template content editor", () => {
  it("shows an image above the pixel limit as a file that opens in full size, and others at display size", async () => {
    const big = "01929b1e-0000-7000-8000-0000000000e1";
    const small = "01929b1e-0000-7000-8000-0000000000e2";
    rememberReferences({ tooLargeImages: [big] });
    await renderWithProviders(
      <TemplateContentEditor
        initial={{
          type: "doc",
          content: [
            { type: "image", attrs: { attachmentId: big, alt: "Scan" } },
            { type: "image", attrs: { attachmentId: small, alt: "Logo" } },
          ],
        }}
        fields={[]}
        label="Template content"
        images={{ url: (id, _version, size) => `/files/${id}${size ? `?size=${size}` : ""}`, upload: null }}
        onChange={vi.fn()}
      />,
    );
    expect(await screen.findByText("Scan is too large to show here.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Scan" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open full size" }).getAttribute("href")).toBe(`/files/${big}`);
    expect(screen.getByRole("img", { name: "Logo" }).getAttribute("src")).toBe(
      `/files/${small}?size=display`,
    );
  });

  it("uploads ten images chosen at once one after the other instead of failing", async () => {
    let running = 0;
    let most = 0;
    const upload = vi.fn(async (file: File) => {
      running += 1;
      most = Math.max(most, running);
      try {
        if (running > 1) {
          throw new ApiError(503, {
            type: "urn:lunedo:problem:busy",
            title: "The server is busy",
            status: 503,
            code: "busy",
            retryAfterSeconds: 2,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { id: crypto.randomUUID(), name: file.name };
      } finally {
        running -= 1;
      }
    });
    const onChange = vi.fn();
    await renderWithProviders(
      <TemplateContentEditor
        initial={{ type: "doc", content: [{ type: "paragraph" }] }}
        fields={[]}
        label="Template content"
        images={{ url: (id) => `/files/${id}`, upload }}
        onChange={onChange}
      />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const files = Array.from(
      { length: 10 },
      (_, index) => new File(["png"], `image-${index}.png`, { type: "image/png" }),
    );
    fireEvent.change(input, { target: { files } });
    await waitFor(() => expect(images(onChange.mock.lastCall?.[0])).toBe(10), { timeout: 5000 });
    expect(upload).toHaveBeenCalledTimes(10);
    expect(most).toBe(1);
    expect(screen.queryByText(/could not be added/)).toBeNull();
  });
});
