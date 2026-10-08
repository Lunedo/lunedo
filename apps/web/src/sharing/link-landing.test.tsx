import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, problem, type RecordedRequest } from "../testing/render.js";

const TOKEN = `${"a".repeat(16)}${"b".repeat(32)}`;
const PAGE = "01929b1e-0000-7000-8000-0000000000b2";
const FILE = "01929b1e-0000-7000-8000-0000000000c1";

const info = () => ({
  body: {
    name: "Example Wiki",
    setupComplete: true,
    language: "en",
    accentColor: "petrol",
    passwordMinLength: 12,
    selfRegistration: false,
    organization: null,
  },
});

const sharedPage = {
  itemId: PAGE,
  title: "Status page",
  document: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "All systems normal" }] }],
  },
  updatedAt: "2026-10-05T08:00:00.000Z",
  attachments: [
    {
      id: FILE,
      itemId: PAGE,
      name: "Report.pdf",
      contentType: "application/pdf",
      preview: "pdf",
      inline: false,
      size: 2048,
      version: 1,
      versions: 1,
      uploadedAt: "2026-10-05T08:00:00.000Z",
      uploadedBy: null,
    },
  ],
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
});

async function renderLink() {
  window.history.replaceState(null, "", `/s/${TOKEN}`);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("opening a share link", () => {
  it("asks anonymous visitors for the password and then shows only the page", async () => {
    const opens: RecordedRequest[] = [];
    let pageRequest: RecordedRequest | undefined;
    mockApi({
      "GET /api/v1/instance/info": info,
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`POST /api/v1/share-links/${TOKEN}/open`]: (request) => {
        opens.push(request);
        const password = (request.body as { password?: string }).password;
        if (!password) return problem(401, "passwordRequired");
        if (password !== "harbour lantern") return problem(401, "wrongPassword");
        return { body: { kind: "anonymous", itemId: PAGE, unlock: "proof" } };
      },
      [`GET /api/v1/share-links/${TOKEN}/page`]: (request) => {
        pageRequest = request;
        return { body: sharedPage };
      },
    });
    await renderLink();
    expect(await screen.findByText("This link is protected")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Open page" }));
    expect(await screen.findByText("Enter the password.")).toBeTruthy();
    expect(opens).toHaveLength(1);
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Open page" }));
    expect(await screen.findByText(/The password is not correct/)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText("Password"));
    await userEvent.type(screen.getByLabelText("Password"), "harbour lantern");
    await userEvent.click(screen.getByRole("button", { name: "Open page" }));
    expect(await screen.findByRole("heading", { name: "Status page" })).toBeTruthy();
    expect(screen.getByText("All systems normal")).toBeTruthy();
    expect(pageRequest?.headers.get("x-pagehall-unlock")).toBe("proof");
    expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe(
      `/api/v1/share-links/${TOKEN}/attachments/${FILE}/content?unlock=proof&download=true`,
    );
    expect(window.location.pathname).toBe(`/s/${TOKEN}`);
  });

  it("sends signed-in visitors to the page itself", async () => {
    mockApi({
      "GET /api/v1/instance/info": info,
      "GET /api/v1/auth/session": () => ({
        body: {
          sessionKind: "full",
          account: {
            id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
            email: "olivia@example.org",
            name: "Olivia Owner",
          },
          methods: ["password"],
          recentlyAuthenticated: true,
        },
      }),
      [`POST /api/v1/share-links/${TOKEN}/open`]: () => ({
        body: { kind: "account", itemId: PAGE, unlock: null },
      }),
    });
    await renderLink();
    await waitFor(() => expect(window.location.pathname).toMatch(new RegExp(`^/shared/${PAGE}`)));
  });

  it("explains a revoked or expired link", async () => {
    mockApi({
      "GET /api/v1/instance/info": info,
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`POST /api/v1/share-links/${TOKEN}/open`]: () => problem(404, "linkNotFound"),
    });
    await renderLink();
    expect(await screen.findByText("This link no longer works")).toBeTruthy();
    expect(screen.getByText(/has expired or was revoked/)).toBeTruthy();
  });

  it("asks to sign in for links that need an account", async () => {
    mockApi({
      "GET /api/v1/instance/info": info,
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`POST /api/v1/share-links/${TOKEN}/open`]: () => problem(401, "signInRequired"),
    });
    await renderLink();
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toContain(encodeURIComponent(`/s/${TOKEN}`));
  });
});
