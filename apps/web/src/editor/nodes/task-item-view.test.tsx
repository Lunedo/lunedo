import { screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "../../i18n/index.js";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { createEditorExtensions } from "../extensions/index.js";
import { rememberReferences } from "../references.js";

describe("tasks in the template editor", () => {
  it("say in visible text why they cannot be checked there", async () => {
    mockApi({ "GET /api/v1/account/preferences": () => ({ body: [] }) });
    const i18n = await initI18n(["en"]);
    const editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null, onFocusToolbar: () => {} }),
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { id: "01929b1e-0000-7000-8000-0000000000e1" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Review the plan" }] }],
              },
            ],
          },
        ],
      },
    });
    await renderWithProviders(
      <PreferencesProvider>
        <EditorContent editor={editor} />
      </PreferencesProvider>,
    );
    const checkbox = await screen.findByRole("checkbox", { name: "Mark as done: Review the plan" });
    expect((checkbox as HTMLInputElement).disabled).toBe(true);
    const hint = screen.getByText("Tasks are checked on the pages made from this template.");
    expect(checkbox.getAttribute("aria-describedby")).toBe(hint.id);
    editor.destroy();
  });
});

describe("task assignees", () => {
  it("show the profile picture of the assignee like the rest of the app", async () => {
    mockApi({ "GET /api/v1/account/preferences": () => ({ body: [] }) });
    const i18n = await initI18n(["en"]);
    const assignee = "01929b1e-0000-7000-8000-0000000000f2";
    rememberReferences({ people: { [assignee]: "Jonas Berger" }, pages: {}, pictures: { [assignee]: "v2" } });
    const editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null, onFocusToolbar: () => {} }),
      content: {
        type: "doc",
        content: [
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { id: "01929b1e-0000-7000-8000-0000000000e2", assignee },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Set the severity" }] }],
              },
            ],
          },
        ],
      },
    });
    await renderWithProviders(
      <PreferencesProvider>
        <EditorContent editor={editor} />
      </PreferencesProvider>,
    );
    await screen.findByText("Jonas Berger");
    expect(document.querySelector(".ld-task-chip img")?.getAttribute("src")).toBe(
      `/api/v1/accounts/${assignee}/picture?v=v2`,
    );
    editor.destroy();
  });
});
