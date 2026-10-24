import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../../app.js";
import { initI18n } from "../../../i18n/index.js";
import { mockApi, problem } from "../../../testing/render.js";
import { type UploadState, uploadFile } from "./restore-api.js";

const CODE = "VDXK-T5DV-CB5W-NSEN";
const BACKUP = "lunedo-backup-20261023T020000Z-daily-0a1b2c3d.ldbak";
const INFO = {
  name: "Lunedo",
  setupComplete: false,
  language: "en",
  accentColor: "petrol",
  passwordMinLength: 12,
  selfRegistration: false,
  organization: null,
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function renderSetup(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

function step(id: string, state: string) {
  return { id, state };
}

describe("restoring from the setup", () => {
  it("offers the three ways to restore under the setup code and opens one after the code is checked", async () => {
    let session = false;
    const { requests } = mockApi({
      "GET /api/v1/instance/info": () => ({ body: INFO }),
      "GET /api/v1/setup": () => ({ body: { completed: false, session } }),
      "POST /api/v1/setup/session": () => {
        session = true;
        return { status: 204 };
      },
      "GET /api/v1/setup/restore/sources": () => ({
        body: { directory: "/var/lib/lunedo/backups", freeBytes: 1e11, backups: [] },
      }),
    });
    await renderSetup("/setup");
    expect(await screen.findByRole("button", { name: /^Upload a backup/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^From an S3 target/ })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Setup code"), CODE);
    await userEvent.click(screen.getByRole("button", { name: /^From the server/ }));
    expect(await screen.findByRole("heading", { name: "From the server" })).toBeTruthy();
    expect(
      screen.getByText("There is no backup in /var/lib/lunedo/backups. Backups end with .ldbak."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Step 2 of 4 · Backup" })).toBeTruthy();
    expect(requests.find((request) => request.path === "/api/v1/setup/session")?.body).toEqual({
      code: CODE,
    });
  });

  it("restores a backup from the server with the keys and shows each step until sign-in", async () => {
    let polls = 0;
    const { requests } = mockApi({
      "GET /api/v1/instance/info": () => ({ body: INFO }),
      "GET /api/v1/setup": () => ({ body: { completed: false, session: true } }),
      "GET /api/v1/setup/restore/sources": () => ({
        body: {
          directory: "/var/lib/lunedo/backups",
          freeBytes: 1e11,
          backups: [
            {
              name: BACKUP,
              size: 4_200_000,
              createdAt: "2026-10-23T02:00:00.000Z",
              lunedoVersion: "1.0.3",
              scope: "all",
              instanceUrl: "https://old.example.org",
              readable: true,
            },
          ],
        },
      }),
      "POST /api/v1/setup/restore": () => ({ status: 202 }),
      "GET /api/v1/setup/restore/status": () => {
        polls += 1;
        const done = polls > 1;
        return {
          body: {
            state: done ? "done" : "running",
            backup: BACKUP,
            steps: [
              step("verify", "done"),
              step("database", done ? "done" : "running"),
              step("files", done ? "done" : "waiting"),
              step("migrations", done ? "done" : "waiting"),
            ],
            failure: null,
            address: { backup: "https://old.example.org", requested: window.location.origin, adopted: done },
            startedAt: "2026-10-24T10:00:00.000Z",
            finishedAt: done ? "2026-10-24T10:02:00.000Z" : null,
          },
        };
      },
    });
    await renderSetup("/setup?restore=server");
    expect(await screen.findByText(/Found in \/var\/lib\/lunedo\/backups/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Choose a backup.")).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(BACKUP) }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Keys" })).toBeTruthy();
    expect(
      screen.getByText(
        `The backup comes from https://old.example.org. This instance runs under ${window.location.origin}.`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Use the new address/ }).getAttribute("aria-checked")).toBe(
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(screen.getByText("Enter the backup key.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Backup key"));
    const keyFile = new File(
      ["LUNEDO_MASTER_KEYS=1:master\nLUNEDO_BACKUP_KEY=1:backup\n"],
      "lunedo-keys.env",
    );
    await userEvent.upload(screen.getByLabelText("Master keys"), keyFile);
    await waitFor(() =>
      expect((screen.getByLabelText("Backup key") as HTMLInputElement).value).toBe("1:backup"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(await screen.findByRole("heading", { name: "Restoring" })).toBeTruthy();
    expect(requests.find((request) => request.path === "/api/v1/setup/restore")?.body).toEqual({
      source: { type: "directory", name: BACKUP },
      backupKey: "1:backup",
      masterKeys: "LUNEDO_MASTER_KEYS=1:master\nLUNEDO_BACKUP_KEY=1:backup\n",
      instanceUrl: window.location.origin,
    });
    expect(screen.getByRole("button", { name: "Go to sign-in" }).hasAttribute("disabled")).toBe(true);
    expect(await screen.findByText("Restored", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText("Migrations applied")).toBeTruthy();
    expect(screen.getByText(/The new address was set\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to sign-in" }).hasAttribute("disabled")).toBe(false);
  });

  it("explains a failed step and offers the keys and another backup", async () => {
    mockApi({
      "GET /api/v1/instance/info": () => ({ body: INFO }),
      "GET /api/v1/setup": () => ({ body: { completed: false, session: true } }),
      "GET /api/v1/setup/restore/status": () => ({
        body: {
          state: "failed",
          backup: BACKUP,
          steps: [
            step("verify", "failed"),
            step("database", "waiting"),
            step("files", "waiting"),
            step("migrations", "waiting"),
          ],
          failure: {
            code: "backupKey",
            message: "The backup is encrypted with backup key version 1 (fingerprint ab)",
          },
          address: { backup: null, requested: null, adopted: false },
          startedAt: "2026-10-24T10:00:00.000Z",
          finishedAt: "2026-10-24T10:00:01.000Z",
        },
      }),
    });
    await renderSetup("/setup?restore=progress");
    expect(await screen.findByText("The restore failed")).toBeTruthy();
    expect(screen.getByText(/The backup key does not fit this backup\. Nothing was changed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check the keys" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose another backup" })).toBeTruthy();
  });

  it("lists the backups of a bucket only after every needed field is filled", async () => {
    const { requests } = mockApi({
      "GET /api/v1/instance/info": () => ({ body: INFO }),
      "GET /api/v1/setup": () => ({ body: { completed: false, session: true } }),
      "POST /api/v1/setup/restore/s3": (request) =>
        (request.body as { secretAccessKey: string }).secretAccessKey === "secret"
          ? { body: { backups: [] } }
          : problem(502, "backupTargetFailed", { problem: "credentials" }),
    });
    await renderSetup("/setup?restore=s3");
    await userEvent.click(await screen.findByRole("button", { name: "Connect and load backups" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Bucket"));
    expect(requests.some((request) => request.path === "/api/v1/setup/restore/s3")).toBe(false);
    await userEvent.type(screen.getByLabelText("Bucket"), "old-backups");
    await userEvent.type(screen.getByLabelText("Access key"), "key");
    await userEvent.type(screen.getByLabelText("Secret key"), "secret");
    await userEvent.click(screen.getByRole("button", { name: "Connect and load backups" }));
    expect(
      await screen.findByText("There is no backup in old-backups. Backups end with .ldbak."),
    ).toBeTruthy();
    expect(requests.find((request) => request.path === "/api/v1/setup/restore/s3")?.body).toMatchObject({
      endpoint: null,
      bucket: "old-backups",
      prefix: "",
    });
  });
});

class FakeRequest {
  static sent: { url: string; size: number }[] = [];
  static answer: (url: string, size: number) => { status: number; body: unknown } = () => ({
    status: 200,
    body: {},
  });
  upload = { onprogress: null as ((event: { loaded: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  responseText = "";
  withCredentials = false;
  #url = "";

  open(_method: string, url: string) {
    this.#url = url;
  }

  setRequestHeader() {}

  abort() {
    this.onabort?.();
  }

  send(body: Blob) {
    FakeRequest.sent.push({ url: this.#url, size: body.size });
    const answer = FakeRequest.answer(this.#url, body.size);
    queueMicrotask(() => {
      if (answer.status === 0) {
        this.onerror?.();
        return;
      }
      this.status = answer.status;
      this.responseText = JSON.stringify(answer.body);
      this.onload?.();
    });
  }
}

describe("uploading a backup in parts", () => {
  it("makes the parts smaller when a reverse proxy refuses their size and continues after a lost connection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const size = 20 * 1024 * 1024;
    const file = new File([new Uint8Array(size)], "backup.ldbak");
    let received = 0;
    let dropped = false;
    FakeRequest.sent = [];
    FakeRequest.answer = (url, bytes) => {
      const offset = Number(new URL(url, "http://localhost").searchParams.get("offset"));
      if (bytes > 4 * 1024 * 1024) return { status: 413, body: { code: "payloadTooLarge", status: 413 } };
      if (offset === 8 * 1024 * 1024 && !dropped) {
        dropped = true;
        return { status: 0, body: null };
      }
      received = offset + bytes;
      return {
        status: 200,
        body: {
          id: "u",
          name: "backup.ldbak",
          size,
          received,
          complete: received === size,
          file: received === size ? "backup.ldbak" : null,
        },
      };
    };
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    mockApi({
      "GET /api/v1/setup/restore/uploads/u": () => ({
        body: { id: "u", name: "backup.ldbak", size, received, complete: false, file: null },
      }),
    });
    const upload: UploadState = {
      id: "u",
      name: "backup.ldbak",
      size,
      received: 0,
      complete: false,
      file: null,
    };
    const result = await uploadFile({
      file,
      upload,
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    vi.useRealTimers();
    expect(result).toMatchObject({ complete: true, file: "backup.ldbak" });
    expect(FakeRequest.sent[0]?.size).toBe(8 * 1024 * 1024);
    expect(FakeRequest.sent.slice(1).every((part) => part.size <= 4 * 1024 * 1024)).toBe(true);
    expect(FakeRequest.sent.filter((part) => part.url.endsWith(`offset=${8 * 1024 * 1024}`))).toHaveLength(2);
  });

  it("keeps the address of the backup when chosen", async () => {
    const { requests } = mockApi({
      "GET /api/v1/instance/info": () => ({ body: INFO }),
      "GET /api/v1/setup": () => ({ body: { completed: false, session: true } }),
      "GET /api/v1/setup/restore/sources": () => ({
        body: {
          directory: "/var/lib/lunedo/backups",
          freeBytes: 1e11,
          backups: [
            {
              name: BACKUP,
              size: 4_200_000,
              createdAt: "2026-10-23T02:00:00.000Z",
              lunedoVersion: "1.0.3",
              scope: "all",
              instanceUrl: "https://old.example.org",
              readable: true,
            },
          ],
        },
      }),
      "POST /api/v1/setup/restore": () => ({ status: 202 }),
    });
    await renderSetup("/setup?restore=server");
    await userEvent.click(await screen.findByRole("radio", { name: new RegExp(BACKUP) }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Keep the old one/ }));
    await userEvent.type(screen.getByLabelText("Backup key"), "1:backup");
    await userEvent.upload(
      screen.getByLabelText("Master keys"),
      new File(["LUNEDO_MASTER_KEYS=1:master\n"], "keys.env"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path === "/api/v1/setup/restore")?.body).toMatchObject({
        instanceUrl: null,
      }),
    );
  });
});
