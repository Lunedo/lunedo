import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { delimiterOf, isRenderMessage, MAX_ROWS, parseCsv } from "../preview/protocol.js";
import { mockApi, type RecordedRequest, renderWithProviders } from "../testing/render.js";
import { AttachmentsSection, PageDropZone } from "./attachments-section.js";
import { AttachmentPreviewProvider } from "./preview-host.js";
import { UploadsProvider } from "./uploads.js";

const PAGE = "01929b1e-0000-7000-8000-0000000000b2";
const REPORT = "01929b1e-0000-7000-8000-0000000000c1";
const PHOTO = "01929b1e-0000-7000-8000-0000000000c2";

const attachment = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  itemId: PAGE,
  name,
  contentType: "application/pdf",
  preview: "pdf",
  inline: false,
  size: 2_400_000,
  version: 2,
  versions: 2,
  uploadedAt: "2026-10-05T08:00:00.000Z",
  uploadedBy: { id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c", name: "Olivia Owner" },
  ...extra,
});

class FakeUpload {
  static instances: FakeUpload[] = [];
  upload: {
    onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  statusText = "";
  responseText = "";
  withCredentials = false;
  url = "";
  body: unknown = null;
  headers = new Map<string, string>();

  constructor() {
    FakeUpload.instances.push(this);
  }

  open(_method: string, url: string) {
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body: unknown) {
    this.body = body;
  }

  abort() {
    this.onabort?.();
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true });
  }

  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

let requests: RecordedRequest[] = [];
let list: ReturnType<typeof attachment>[] = [];

function routes(extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    [`GET /api/v1/pages/${PAGE}/attachments`]: () => ({ body: list }),
    [`GET /api/v1/attachments/${REPORT}`]: () => ({ body: list.find((entry) => entry.id === REPORT) }),
    [`GET /api/v1/attachments/${PHOTO}`]: () => ({ body: list.find((entry) => entry.id === PHOTO) }),
    [`GET /api/v1/attachments/${REPORT}/versions`]: () => ({
      body: [
        {
          id: "01929b1e-0000-7000-8000-0000000000d2",
          number: 2,
          name: "Report.pdf",
          size: 2_400_000,
          uploadedAt: "2026-10-05T08:00:00.000Z",
          uploadedBy: { id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c", name: "Olivia Owner" },
          restoredFrom: null,
          kept: false,
        },
        {
          id: "01929b1e-0000-7000-8000-0000000000d1",
          number: 1,
          name: "Report.pdf",
          size: 1_200_000,
          uploadedAt: "2026-10-04T08:00:00.000Z",
          uploadedBy: null,
          restoredFrom: null,
          kept: true,
        },
      ],
    }),
    ...extra,
  });
}

async function renderSection(canEdit = true) {
  return renderWithProviders(
    <PreferencesProvider>
      <UploadsProvider pageId={PAGE}>
        <AttachmentPreviewProvider canEdit={canEdit}>
          <PageDropZone enabled={canEdit} title="VPN access">
            <p>Page text</p>
            <AttachmentsSection pageId={PAGE} canEdit={canEdit} />
          </PageDropZone>
        </AttachmentPreviewProvider>
      </UploadsProvider>
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  FakeUpload.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeUpload);
  list = [
    attachment(REPORT, "Report.pdf"),
    attachment(PHOTO, "Rack.png", { preview: "image", inline: true, size: 512_000, version: 1, versions: 1 }),
  ];
  ({ requests } = routes());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the attachments of a page", () => {
  it("lists each file with name, type and size", async () => {
    await renderSection(false);
    const report = await screen.findByRole("button", { name: /^Report\.pdf/ });
    expect(report.textContent).toContain("PDF document (PDF)");
    expect(report.textContent).toMatch(/2(\.|,)3 MB/);
    expect(report.textContent).toContain("version 2");
    expect(screen.getByRole("button", { name: /^Rack\.png/ }).textContent).toContain("Image (PNG)");
    expect(screen.queryByRole("button", { name: "Upload files" })).toBeNull();
  });

  it("marks files that readers do not see yet as new or changed in the draft", async () => {
    list = [
      attachment(REPORT, "Report.pdf", { draft: "changed" }),
      attachment(PHOTO, "Rack.png", { draft: "added" }),
    ];
    await renderSection(true);
    expect((await screen.findByRole("button", { name: /^Report\.pdf/ })).textContent).toContain(
      "Changed in draft",
    );
    expect(screen.getByRole("button", { name: /^Rack\.png/ }).textContent).toContain("New in draft");
  });

  it("keeps files deleted in the draft listed for editors and restores them", async () => {
    const restored: string[] = [];
    list = [attachment(REPORT, "Report.pdf", { draft: "deleted" })];
    ({ requests } = routes({
      [`POST /api/v1/pages/${PAGE}/attachments/${REPORT}/restore`]: () => {
        restored.push(REPORT);
        list = [attachment(REPORT, "Report.pdf")];
        return { status: 204 };
      },
    }));
    await renderSection(true);
    expect((await screen.findByRole("button", { name: /^Report\.pdf/ })).textContent).toContain(
      "Deleted in draft",
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions for Report.pdf" }));
    expect(screen.queryByRole("menuitem", { name: "Delete file" })).toBeNull();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Restore file" }));
    await waitFor(() => expect(restored).toEqual([REPORT]));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^Report\.pdf/ }).textContent).not.toContain(
        "Deleted in draft",
      ),
    );
  });

  it("hides the section from readers when the page has no files", async () => {
    list = [];
    await renderSection(false);
    await waitFor(() => expect(requests.some((r) => r.path.endsWith("/attachments"))).toBe(true));
    expect(screen.queryByRole("heading", { name: /Attachments/ })).toBeNull();
  });

  it("explains how to add files when an editor sees an empty list", async () => {
    list = [];
    await renderSection(true);
    expect(await screen.findByText("No files yet. Upload files or drop them on the page.")).toBeTruthy();
  });

  it("uploads chosen files with real progress and refreshes the list", async () => {
    await renderSection(true);
    await screen.findByRole("button", { name: /^Report\.pdf/ });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("missing file input");
    const file = new File(["x".repeat(2048)], "Network plan.pdf", { type: "application/pdf" });
    await userEvent.upload(input, file);
    const upload = FakeUpload.instances[0];
    if (!upload) throw new Error("upload did not start");
    expect(upload.url).toBe(`/api/v1/pages/${PAGE}/attachments?name=Network%20plan.pdf`);
    expect(upload.body).toBe(file);
    upload.progress(1024, 2048);
    const progress = await screen.findByRole("progressbar", { name: "Upload of Network plan.pdf" });
    await waitFor(() => expect(progress.getAttribute("aria-valuenow")).toBe("50"));
    const before = requests.filter((r) => r.path.endsWith("/attachments")).length;
    list = [...list, attachment(REPORT.replace("c1", "c3"), "Network plan.pdf", { version: 1 })];
    upload.respond(201, list[2]);
    await screen.findByRole("button", { name: /^Network plan\.pdf/ });
    expect(requests.filter((r) => r.path.endsWith("/attachments")).length).toBeGreaterThan(before);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("names the size limit when a file is too large and retries without choosing it again", async () => {
    await renderSection(true);
    await screen.findByRole("button", { name: /^Report\.pdf/ });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("missing file input");
    await userEvent.upload(input, new File(["video"], "Recording.mp4", { type: "video/mp4" }));
    FakeUpload.instances[0]?.respond(413, {
      type: "urn:pagehall:problem:fileTooLarge",
      title: "The file is larger than allowed",
      status: 413,
      code: "fileTooLarge",
      maxBytes: 100 * 1024 * 1024,
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Recording.mp4 was not uploaded");
    expect(alert.textContent).toContain("limit of 100 MB");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(FakeUpload.instances).toHaveLength(2);
    expect((FakeUpload.instances[1]?.body as File | undefined)?.name).toBe("Recording.mp4");
  });

  it("cancels a running upload", async () => {
    await renderSection(true);
    await screen.findByRole("button", { name: /^Report\.pdf/ });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("missing file input");
    await userEvent.upload(input, new File(["a"], "Notes.txt", { type: "text/plain" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel upload of Notes.txt" }));
    await waitFor(() => expect(screen.queryByText("Notes.txt")).toBeNull());
  });

  it("deletes a file with undo", async () => {
    const restored: string[] = [];
    ({ requests } = routes({
      [`DELETE /api/v1/attachments/${REPORT}`]: () => {
        list = list.filter((entry) => entry.id !== REPORT);
        return { status: 204 };
      },
      [`POST /api/v1/pages/${PAGE}/attachments/${REPORT}/restore`]: () => {
        restored.push(REPORT);
        list = [attachment(REPORT, "Report.pdf"), ...list];
        return { status: 204 };
      },
    }));
    await renderSection(true);
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Report.pdf" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete file" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Report\.pdf/ })).toBeNull());
    await userEvent.click(await screen.findByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(restored).toEqual([REPORT]));
    expect(await screen.findByRole("button", { name: /^Report\.pdf/ })).toBeTruthy();
  });

  it("opens a preview with versions and restores an earlier one", async () => {
    ({ requests } = routes({
      [`POST /api/v1/attachments/${REPORT}/versions/1/restore`]: () => ({ status: 200, body: {} }),
    }));
    await renderSection(true);
    await userEvent.click(await screen.findByRole("button", { name: /^Rack\.png/ }));
    const drawer = await screen.findByRole("dialog", { name: "Rack.png" });
    const image = await within(drawer).findByRole("img", { name: "Rack.png" });
    expect(image.getAttribute("src")).toBe(`/api/v1/attachments/${PHOTO}/content?version=1`);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: /^Report\.pdf/ }));
    const report = await screen.findByRole("dialog", { name: "Report.pdf" });
    await userEvent.click(within(report).getByRole("button", { name: "Versions (2)" }));
    const download = await within(report).findAllByRole("link", { name: "Download" });
    expect(download.map((link) => link.getAttribute("href"))).toContain(
      `/api/v1/attachments/${REPORT}/content?version=1&download=true`,
    );
    await userEvent.click(within(report).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path.endsWith("/versions/1/restore"))).toBe(true),
    );
    expect(await screen.findByText("Version 1 is current again")).toBeTruthy();
  });

  it("keeps the summary and the download away from the edge of the preview panel", async () => {
    routes();
    await renderSection(false);
    await userEvent.click(await screen.findByRole("button", { name: /^Rack.png/ }));
    const drawer = await screen.findByRole("dialog", { name: "Rack.png" });
    const summary = await within(drawer).findByText(/Image/);
    const download = within(drawer).getByRole("link", { name: "Download" });
    const padded = drawer.querySelector(".p-4");
    expect(padded?.contains(summary)).toBe(true);
    expect(padded?.contains(download)).toBe(true);
  });

  it("marks a version to keep and shows which versions are kept", async () => {
    ({ requests } = routes({
      [`PUT /api/v1/attachments/${REPORT}/versions/2/keep`]: () => ({ body: {} }),
    }));
    await renderSection(true);
    await userEvent.click(await screen.findByRole("button", { name: /^Report\.pdf/ }));
    const report = await screen.findByRole("dialog", { name: "Report.pdf" });
    await userEvent.click(within(report).getByRole("button", { name: "Versions (2)" }));
    expect(await within(report).findByText("Kept")).toBeTruthy();
    expect(within(report).getByRole("button", { name: "Stop keeping" })).toBeTruthy();
    await userEvent.click(within(report).getByRole("button", { name: "Keep" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PUT" && r.path.endsWith("/versions/2/keep"))?.body).toEqual({
        kept: true,
      }),
    );
    expect(await screen.findByText("Version 2 is kept")).toBeTruthy();
  });

  it("offers no keep marks to readers", async () => {
    await renderSection(false);
    await userEvent.click(await screen.findByRole("button", { name: /^Report\.pdf/ }));
    const report = await screen.findByRole("dialog", { name: "Report.pdf" });
    await userEvent.click(within(report).getByRole("button", { name: "Versions (2)" }));
    expect(await within(report).findByText("Kept")).toBeTruthy();
    expect(within(report).queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("explains a preview that could not be loaded and offers a retry", async () => {
    ({ requests } = routes({ [`GET /api/v1/attachments/${REPORT}`]: () => ({ status: 500, body: {} }) }));
    await renderSection(false);
    await userEvent.click(await screen.findByRole("button", { name: /^Report\.pdf/ }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("the preview protocol", () => {
  it("parses quoted cells, line breaks inside quotes and both line endings", () => {
    expect(parseCsv('name,notes\r\n"Doe, Jane","said ""hi""\nthen left"\nBob,')).toEqual({
      rows: [
        ["name", "notes"],
        ["Doe, Jane", 'said "hi"\nthen left'],
        ["Bob", ""],
      ],
      truncated: false,
    });
  });

  it("stops after the row limit and says so", () => {
    const result = parseCsv("a\n".repeat(MAX_ROWS + 50));
    expect(result.rows).toHaveLength(MAX_ROWS);
    expect(result.truncated).toBe(true);
  });

  it("detects the delimiter from the first line and the file name", () => {
    expect(delimiterOf("export.csv", "a;b;c\n1,5;2;3")).toBe(";");
    expect(delimiterOf("export.csv", "a,b\n1,2")).toBe(",");
    expect(delimiterOf("export.tsv", "a,b")).toBe("\t");
  });

  it("accepts only render messages with a known kind and bytes", () => {
    const valid = { type: "render", kind: "pdf", name: "a.pdf", bytes: new ArrayBuffer(1) };
    expect(isRenderMessage(valid)).toBe(true);
    expect(isRenderMessage({ ...valid, kind: "html" })).toBe(false);
    expect(isRenderMessage({ ...valid, bytes: "<script>" })).toBe(false);
    expect(isRenderMessage(null)).toBe(false);
  });
});
