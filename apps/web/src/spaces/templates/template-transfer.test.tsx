import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../../testing/render.js";
import type { PageTemplate } from "../content-queries.js";
import { SaveTemplateDialog } from "./save-template-dialog.js";
import type { ImportedTemplate, ImportPreview, TemplateLevelApi } from "./template-transfer-api.js";
import { TemplatesManager } from "./templates-manager.js";

const SPACE = "01929b1e-0000-7000-8000-0000000000a1";
const PAGE = "01929b1e-0000-7000-8000-0000000000b1";
const RETRO = "01929b1e-0000-7000-8000-0000000000c1";
const IMPORT = "01929b1e-0000-7000-8000-0000000000d1";

function inRouter(ui: ReactNode) {
  const root = createRootRoute({ component: () => <PreferencesProvider>{ui}</PreferencesProvider> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

const retro: PageTemplate = {
  id: RETRO,
  level: "space",
  organizationId: null,
  spaceId: SPACE,
  name: "Retro",
  description: "Team retrospective",
  category: "meetings",
  title: "Retro {date}",
  fields: [],
  document: { type: "doc", content: [{ type: "paragraph" }] },
  series: null,
  updatedAt: "2026-10-05T08:00:00.000Z",
};

function imported(overrides: Partial<ImportedTemplate> = {}): ImportedTemplate {
  return {
    index: 0,
    name: "Retro",
    description: "Team retrospective",
    category: "meetings",
    language: "en",
    title: "Retro",
    fields: [],
    series: null,
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Went well" }] }],
    },
    files: [],
    removed: {},
    blockedEmbeds: [],
    problems: [],
    valid: true,
    conflict: null,
    ...overrides,
  } as ImportedTemplate;
}

function fakeApi(preview?: ImportPreview): TemplateLevelApi & { [key: string]: ReturnType<typeof vi.fn> } {
  return {
    fileUrl: vi.fn((templateId: string, fileId: string) => `/files/${templateId}/${fileId}`),
    uploadImage: vi.fn(),
    exportSummary: vi.fn(async () => ({
      templates: [{ name: "Retro", files: 1, removed: { pageLink: 2, mention: 1 } }],
    })),
    exportFile: vi.fn(async () => undefined),
    preview: vi.fn(async () => preview as ImportPreview),
    previewFileUrl: vi.fn((id: string, fileId: string) => `/preview/${id}/${fileId}`),
    confirm: vi.fn(async () => ({ created: [retro], replaced: [], skipped: 0 })),
    discard: vi.fn(async () => undefined),
  } as unknown as TemplateLevelApi & { [key: string]: ReturnType<typeof vi.fn> };
}

async function renderManager(api: TemplateLevelApi) {
  mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
  const onImported = vi.fn(async () => undefined);
  await renderWithProviders(
    inRouter(
      <TemplatesManager
        templates={[retro]}
        loading={false}
        error={null}
        onRetry={() => undefined}
        canManage
        transfer={api}
        onImported={onImported}
        onCreate={async () => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
      />,
    ),
  );
  return { onImported };
}

async function chooseFile(name = "retro.pagehall-template.json") {
  const input = await screen.findByLabelText(/Drop a template file here/);
  await userEvent.upload(input as HTMLInputElement, new File(["{}"], name, { type: "application/json" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exporting templates", () => {
  it("lists what the export removes before the download", async () => {
    const api = fakeApi();
    await renderManager(api);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Retro" }));
    await userEvent.click(screen.getByRole("button", { name: "Export 1 template" }));
    const dialog = await screen.findByRole("dialog", { name: "Export templates" });
    expect(await within(dialog).findByText("Removed: 2 page links, 1 mention")).toBeTruthy();
    expect(within(dialog).getByText("1 image")).toBeTruthy();
    expect(api.exportSummary).toHaveBeenCalledWith([RETRO]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Download file" }));
    await waitFor(() => expect(api.exportFile).toHaveBeenCalledWith([RETRO]));
  });

  it("exports all templates when none is selected", async () => {
    const api = fakeApi();
    await renderManager(api);
    await userEvent.click(await screen.findByRole("button", { name: "Export all" }));
    await screen.findByRole("dialog", { name: "Export templates" });
    expect(api.exportSummary).toHaveBeenCalledWith(null);
  });
});

describe("importing templates", () => {
  it("asks for a file before checking", async () => {
    const api = fakeApi();
    await renderManager(api);
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    await userEvent.click(await screen.findByRole("button", { name: "Check file" }));
    expect(await screen.findByText("Choose a template file.")).toBeTruthy();
    expect(api.preview).not.toHaveBeenCalled();
  });

  it("prefills a new name for a conflict and imports with the edited name", async () => {
    const api = fakeApi({
      id: IMPORT,
      fileName: "retro.pagehall-template.json",
      expiresAt: "2026-10-18T20:00:00.000Z",
      templates: [imported({ conflict: { templateId: RETRO, suggestedName: "Retro (imported)" } })],
    });
    const { onImported } = await renderManager(api);
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    await chooseFile();
    await userEvent.click(screen.getByRole("button", { name: "Check file" }));
    const name = await screen.findByLabelText(/Name of the new template/);
    expect((name as HTMLInputElement).value).toBe("Retro (imported)");
    await userEvent.clear(name);
    await userEvent.type(name, "Retro for team B");
    await userEvent.click(screen.getByRole("button", { name: "Import 1 template" }));
    await waitFor(() =>
      expect(api.confirm).toHaveBeenCalledWith(
        IMPORT,
        [{ index: 0, action: "create", name: "Retro for team B" }],
        false,
      ),
    );
    expect(onImported).toHaveBeenCalled();
  });

  it("replaces the existing template when chosen", async () => {
    const api = fakeApi({
      id: IMPORT,
      fileName: "retro.pagehall-template.json",
      expiresAt: "2026-10-18T20:00:00.000Z",
      templates: [imported({ conflict: { templateId: RETRO, suggestedName: "Retro (imported)" } })],
    });
    await renderManager(api);
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    await chooseFile();
    await userEvent.click(screen.getByRole("button", { name: "Check file" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Replace the existing template/ }));
    await userEvent.click(screen.getByRole("button", { name: "Import 1 template" }));
    await waitFor(() =>
      expect(api.confirm).toHaveBeenCalledWith(IMPORT, [{ index: 0, action: "replace" }], false),
    );
  });

  it("shows problems and imports only the valid templates when asked to", async () => {
    const api = fakeApi({
      id: IMPORT,
      fileName: "two.pagehall-template.json",
      expiresAt: "2026-10-18T20:00:00.000Z",
      templates: [
        imported({ removed: { mention: 1 }, blockedEmbeds: ["https://unknown.example.com/x"] }),
        imported({
          index: 1,
          name: "Broken",
          valid: false,
          document: null,
          problems: [{ place: "field 3", message: "Template 'Broken', field 3: unknown key color" }],
        }),
      ],
    });
    await renderManager(api);
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    await chooseFile("two.pagehall-template.json");
    await userEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(await screen.findByText("Template 'Broken', field 3: unknown key color")).toBeTruthy();
    expect(screen.getByText("Removed because it pointed to the other instance: 1 mention")).toBeTruthy();
    expect(screen.getByText(/https:\/\/unknown\.example\.com\/x/)).toBeTruthy();
    expect(
      screen.getByText("Some templates are not valid. Choose to import only the valid ones to continue."),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Import 1 template" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /Import only the valid templates/ }));
    await userEvent.click(screen.getByRole("button", { name: "Import 1 template" }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledWith(IMPORT, [], true));
  });

  it("discards the preview when the dialog is closed", async () => {
    const api = fakeApi({
      id: IMPORT,
      fileName: "retro.pagehall-template.json",
      expiresAt: "2026-10-18T20:00:00.000Z",
      templates: [imported()],
    });
    await renderManager(api);
    await userEvent.click(await screen.findByRole("button", { name: "Import" }));
    await chooseFile();
    await userEvent.click(screen.getByRole("button", { name: "Check file" }));
    await screen.findByRole("button", { name: "Import 1 template" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(api.discard).toHaveBeenCalledWith(IMPORT));
  });
});

describe("saving a page as a template", () => {
  it("warns that the images of a restricted page become visible to everyone who can use the template", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${SPACE}/templates/from-page/files`]: () => ({
        body: { files: 2, restricted: true },
      }),
    });
    await renderWithProviders(
      <SaveTemplateDialog
        spaceId={SPACE}
        page={{ id: PAGE, title: "Salaries" }}
        open
        onOpenChange={() => undefined}
      />,
    );
    expect(
      await screen.findByText(
        "This page is restricted. Its 2 images become visible to everyone who can use the template.",
      ),
    ).toBeTruthy();
  });
});
