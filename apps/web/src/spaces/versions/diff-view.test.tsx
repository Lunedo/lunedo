import { diffDocuments } from "@lunedo/editor-schema";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { DiffView } from "./diff-view.js";

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

const diff = diffDocuments(
  {
    title: "Guide",
    document: { type: "doc", content: [paragraph("One"), paragraph("Two"), paragraph("Three")] },
  },
  {
    title: "Guide",
    document: {
      type: "doc",
      content: [paragraph("One more"), paragraph("Two"), paragraph("Three"), paragraph("Four")],
    },
  },
);

describe("the comparison of two versions", () => {
  it("jumps from change to change with buttons and with [ and ]", async () => {
    mockApi({});
    Element.prototype.scrollIntoView = vi.fn();
    await renderWithProviders(
      <PreferencesProvider>
        <DiffView
          comparison={{ diff, references: {} as never }}
          layout="inline"
          beforeLabel="Version 1"
          afterLabel="Draft"
        />
      </PreferencesProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Next change" }));
    expect(screen.getByText(/^Change 1 of \d+$/)).toBeTruthy();
    const first = document.querySelector(".ld-diff-current");
    expect(first).toBeTruthy();
    await userEvent.keyboard("]");
    expect(screen.getByText(/^Change 2 of \d+$/)).toBeTruthy();
    expect(document.querySelector(".ld-diff-current")).not.toBe(first);
    await userEvent.keyboard("[[");
    expect(screen.getByText(/^Change 1 of \d+$/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Previous change" }));
    expect(screen.getByText(/^Change (\d+) of \1$/)).toBeTruthy();
  });
});
