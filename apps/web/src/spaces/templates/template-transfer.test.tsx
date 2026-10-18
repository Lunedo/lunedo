import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/request.js";
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

async function renderManager(
  api: TemplateLevelApi,
  handlers: {
    onCreate?: (input: unknown) => Promise<void>;
    onUpdate?: (id: string, input: unknown) => Promise<void>;
  } = {},
) {
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
        onCreate={handlers.onCreate ?? (async () => undefined)}
        onUpdate={handlers.onUpdate ?? (async () => undefined)}
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

  it("marks a conflicting template and shows a taken name at its field", async () => {
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
    expect(await screen.findByText("A template with this name exists")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
    const name = await screen.findByLabelText(/Name of the new template/);
    await userEvent.clear(name);
    await userEvent.type(name, "retro");
    await userEvent.click(screen.getByRole("button", { name: "Import 1 template" }));
    expect(
      await screen.findByText(
        "A template with this name exists already. Enter another name, or choose to replace it.",
      ),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(api.confirm).not.toHaveBeenCalled();

    vi.mocked(api.confirm).mockRejectedValueOnce(
      new ApiError(409, {
        type: "urn:pagehall:problem:templateNameTaken",
        title: "Taken",
        status: 409,
        code: "templateNameTaken",
        templateIndex: 0,
      } as ConstructorParameters<typeof ApiError>[1]),
    );
    await userEvent.clear(name);
    await userEvent.type(name, "Retro created meanwhile");
    await userEvent.click(screen.getByRole("button", { name: "Import 1 template" }));
    await waitFor(() => expect(api.confirm).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(
        "A template with this name exists already. Enter another name, or choose to replace it.",
      ),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
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
  function routes(restricted: boolean) {
    return mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET /api/v1/spaces/${SPACE}/templates/from-page/files`]: () => ({
        body: { files: 2, restricted },
      }),
      [`POST /api/v1/spaces/${SPACE}/templates/from-page`]: () => ({ status: 201, body: retro }),
    });
  }

  async function open() {
    await renderWithProviders(
      <SaveTemplateDialog
        spaceId={SPACE}
        spaceName="IT Operations"
        page={{ id: PAGE, title: "Salaries" }}
        open
        onOpenChange={() => undefined}
      />,
    );
  }

  it("names who will see a restricted page and saves only after the confirmation", async () => {
    const { requests } = routes(true);
    await open();
    expect(await screen.findByText("This page is restricted")).toBeTruthy();
    expect(
      screen.getByText(
        /As a template, its content becomes visible to everyone who can use the templates of IT Operations: all its editors and space admins, also those who cannot open the page now\. This includes the 2 images of the page\./,
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    const confirm = screen.getByRole("checkbox", {
      name: "Everyone who can use the templates of IT Operations may see this content",
    });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    expect(
      screen.getByText(
        "Confirm that everyone who can use the templates of this space may see the content, or cancel.",
      ),
    ).toBeTruthy();
    expect(requests.some((r) => r.method === "POST")).toBe(false);

    await userEvent.click(confirm);
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({
      pageId: PAGE,
      name: "Salaries",
      confirmRestricted: true,
    });
  });

  it("asks for no confirmation for a page without a restriction", async () => {
    const { requests } = routes(false);
    await open();
    expect(
      await screen.findByText(/The template gets its own copy of the 2 images of the page/),
    ).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({ confirmRestricted: false });
  });
});

describe("the template editor", () => {
  it("opens a template from its row and shows a partial selection", async () => {
    const second = { ...retro, id: IMPORT, name: "Incident review" };
    mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
    await renderWithProviders(
      inRouter(
        <TemplatesManager
          templates={[retro, second]}
          loading={false}
          error={null}
          onRetry={() => undefined}
          canManage
          transfer={fakeApi()}
          onImported={async () => undefined}
          onCreate={async () => undefined}
          onUpdate={async () => undefined}
          onDelete={async () => undefined}
        />,
      ),
    );
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select Retro" }));
    expect(screen.getByRole("checkbox", { name: "Select all templates" }).getAttribute("aria-checked")).toBe(
      "mixed",
    );
    await userEvent.click(screen.getByRole("row", { name: "Edit template Incident review" }));
    expect(await screen.findByRole("dialog", { name: "Edit template" })).toBeTruthy();
  });

  it("accepts typing into name, description and content of a new template", async () => {
    const onCreate = vi.fn(async (_input: unknown) => undefined);
    await renderManager(fakeApi(), { onCreate });
    await userEvent.click(await screen.findByRole("button", { name: "Create template" }));
    const dialog = await screen.findByRole("dialog", { name: "New template" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Name/ }), "Site survey");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Description/ }), "Checklist");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Title of new pages/ }), "Survey");
    const content = await within(dialog).findByRole("textbox", { name: "Content" }, { timeout: 5000 });
    await userEvent.type(content, "Rooms and racks");
    await waitFor(() => expect(content.textContent).toContain("Rooms and racks"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create template" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0]).toEqual([
      expect.objectContaining({
        name: "Site survey",
        description: "Checklist",
        title: "Survey",
      }),
    ]);
    expect(JSON.stringify(onCreate.mock.calls[0]?.[0])).toContain('"text":"Rooms and racks"');
  });

  it("accepts typing into the content of an existing template", async () => {
    const onUpdate = vi.fn(async (_id: string, _input: unknown) => undefined);
    await renderManager(fakeApi(), { onUpdate });
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Retro" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Edit template" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit template" });
    const content = await within(dialog).findByRole("textbox", { name: "Content" }, { timeout: 5000 });
    await userEvent.type(content, "Went well");
    await waitFor(() => expect(content.textContent).toContain("Went well"));
    await userEvent.type(within(dialog).getByRole("textbox", { name: /^Name/ }), " 2027");
    const title = within(dialog).getByRole("textbox", { name: /^Title of new pages/ });
    await userEvent.clear(title);
    await userEvent.type(title, "Retro");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save template" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0]).toEqual([
      RETRO,
      expect.objectContaining({
        name: "Retro 2027",
      }),
    ]);
    expect(JSON.stringify(onUpdate.mock.calls[0]?.[1])).toContain('"text":"Went well"');
  });
});
