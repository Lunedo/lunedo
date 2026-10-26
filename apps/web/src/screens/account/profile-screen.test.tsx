import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/queries.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { ProfileScreen } from "./profile-screen.js";

const ACCOUNT = "01929b1e-0000-7000-8000-0000000000a1";

const session = {
  sessionKind: "full",
  account: {
    id: ACCOUNT,
    email: "ada@example.org",
    name: "Ada Lovelace",
    pictureRef: "5f2b8c1d9a0e4b7c",
    type: "standard",
    homeOrganizationId: null,
  },
  methods: ["password"],
  recentlyAuthenticated: false,
};

async function renderProfile() {
  const root = createRootRoute({ component: ProfileScreen });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await renderWithProviders(<RouterProvider router={router} />, "en", (queryClient) =>
    queryClient.setQueryData(queryKeys.session, session),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("profile", () => {
  it("shows the picture and saves the job title", async () => {
    let profile = {
      name: "Ada Lovelace",
      jobTitle: null as string | null,
      pictureRef: "5f2b8c1d9a0e4b7c",
      nameProvider: null,
    };
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => ({ body: session }),
      "GET /api/v1/account/profile": () => ({ body: profile }),
      "GET /api/v1/account/identities": () => ({ body: [] }),
      "PATCH /api/v1/account/profile": (request) => {
        profile = { ...profile, ...(request.body as { jobTitle: string | null }) };
        return { body: profile };
      },
    });
    await renderProfile();

    const picture = await screen.findByRole("img", { name: "Ada Lovelace" });
    expect(picture.getAttribute("src")).toBe(`/api/v1/accounts/${ACCOUNT}/picture?v=5f2b8c1d9a0e4b7c`);
    expect(screen.getByRole("button", { name: "Replace picture" })).toBeTruthy();

    const jobTitle = screen.getByLabelText("Job title");
    await userEvent.type(jobTitle, "Head of Engineering{Enter}");
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PATCH")?.body).toEqual({
        jobTitle: "Head of Engineering",
      }),
    );
  });

  it("locks a name that comes from an identity provider and names the provider", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => ({ body: session }),
      "GET /api/v1/account/profile": () => ({
        body: { name: "Ada Lovelace", jobTitle: null, pictureRef: null, nameProvider: "Company login" },
      }),
      "GET /api/v1/account/identities": () => ({ body: [] }),
    });
    await renderProfile();

    const name = await screen.findByLabelText("Display name");
    expect((name as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("From Company login. Change the name there.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload picture" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove picture" })).toBeNull();
  });

  it("refuses files that are not small images without uploading them", async () => {
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => ({ body: session }),
      "GET /api/v1/account/profile": () => ({
        body: { name: "Ada Lovelace", jobTitle: null, pictureRef: null, nameProvider: null },
      }),
      "GET /api/v1/account/identities": () => ({ body: [] }),
    });
    await renderProfile();

    const input = await screen.findByLabelText("Upload picture", { selector: "input" });
    await userEvent.upload(input, new File(["<svg/>"], "picture.svg", { type: "image/svg+xml" }), {
      applyAccept: false,
    });
    expect(
      await screen.findByText(
        "The file is not a PNG, JPEG or WebP image of at most 256 KiB. Choose another image.",
      ),
    ).toBeTruthy();
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });
});
