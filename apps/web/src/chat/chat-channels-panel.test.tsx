import { spaceChatEvents } from "@pagehall/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { ChatChannelsPanel } from "./chat-channels-panel.js";

const SPACE = "01929b1e-0000-7000-8000-0000000000c1";
const CHANNEL = "01929b1e-0000-7000-8000-0000000000c2";
const base = `/api/v1/spaces/${SPACE}/chat-channels`;

function channel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL,
    kind: "slack",
    name: "#ops-alerts",
    events: ["pageStatusChanged"],
    state: "working",
    failure: null,
    lastAttemptAt: null,
    lastDeliveredAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

function panel(props: { unavailable?: string; secondaryAction?: boolean } = {}) {
  return (
    <PreferencesProvider>
      <ChatChannelsPanel
        owner={{ kind: "space", spaceId: SPACE }}
        events={spaceChatEvents}
        title="Chat channels"
        description="Only content every space member can read is posted."
        canManage
        unavailable={props.unavailable}
        secondaryAction={props.secondaryAction}
      />
    </PreferencesProvider>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat channels", () => {
  it("checks the form, tests the address and shows a webhook secret only once", async () => {
    let items: unknown[] = [];
    const { requests } = mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET ${base}`]: () => ({ body: { items } }),
      [`POST ${base}/test`]: () => ({
        body: { delivered: false, failure: { reason: "addressGone", status: 404, code: "no_service" } },
      }),
      [`POST ${base}`]: () => {
        items = [channel({ kind: "webhook", name: "Automation" })];
        return { status: 201, body: { channel: items[0], signingSecret: "s3cret-shown-once" } };
      },
    });
    await renderWithProviders(panel());
    expect(await screen.findByText("No channels yet. Connect one to post updates there.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Connect a channel" }));
    const dialog = await screen.findByRole("dialog", { name: "Connect a channel" });
    expect(within(dialog).getByText("In Microsoft Teams (Workflows)")).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    expect(
      await within(dialog).findByText("Enter the webhook address, starting with https://."),
    ).toBeTruthy();
    expect(within(dialog).getByText("Enter a name.")).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole("textbox", { name: "Webhook address" })),
    );

    await userEvent.click(within(dialog).getByRole("radio", { name: "Other (webhook)" }));
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Webhook address" }),
      "https://hooks.example.com/x",
    );
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name in Pagehall" }), "Automation");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send test message" }));
    expect(
      await within(dialog).findByText(
        "The service answered “no_service”. The address was probably removed in Other (webhook). Create a new one there and paste it in Edit.",
      ),
    ).toBeTruthy();

    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    const secret = await screen.findByRole("dialog", { name: "Signing secret for Automation" });
    expect((within(secret).getByRole("textbox", { name: "Signing secret" }) as HTMLInputElement).value).toBe(
      "s3cret-shown-once",
    );
    await userEvent.click(within(secret).getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Automation")).toBeTruthy();
    expect(screen.queryByText("s3cret-shown-once")).toBeNull();
    const created = requests.find(
      (request) => request.method === "POST" && request.path.endsWith("chat-channels"),
    );
    expect(created?.body).toEqual({
      kind: "webhook",
      name: "Automation",
      events: ["pagePublished", "blogPostPublished", "decisionRecorded"],
      target: { url: "https://hooks.example.com/x" },
    });
  });

  it("shows a refused address at its field with the reason and moves the focus there", async () => {
    let answer = problem(400, "invalidChatAddress", { fields: ["body.target.url"], problem: "unresolvable" });
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET ${base}`]: () => ({ body: { items: [] } }),
      [`POST ${base}/test`]: () => answer,
      [`POST ${base}`]: () => answer,
    });
    await renderWithProviders(panel());
    await userEvent.click(await screen.findByRole("button", { name: "Connect a channel" }));
    const dialog = await screen.findByRole("dialog", { name: "Connect a channel" });
    const address = within(dialog).getByRole("textbox", { name: "Webhook address" });
    await userEvent.type(address, "hooks.invalid/workflows/abc");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name in Pagehall" }), "IT-Ops");
    await userEvent.click(within(dialog).getByRole("button", { name: "Connect" }));
    const reason =
      "Pagehall could not find this host. Check the address for typos, and that this server can reach the internet.";
    expect(await within(dialog).findByText(reason)).toBeTruthy();
    expect(address.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(address));
    expect(within(dialog).queryByRole("alert")).toBeNull();
    await userEvent.type(address, "x");
    expect(within(dialog).queryByText(reason)).toBeNull();

    answer = problem(503, "busy");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send test message" }));
    const notice = await within(dialog).findByRole("alert");
    expect(within(notice).getByText("The test message was not delivered")).toBeTruthy();
    await waitFor(() => expect(notice.parentElement?.contains(document.activeElement)).toBe(true));
  });

  it("tells untested channels and failed tests from working ones", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET ${base}`]: () => ({
        body: {
          items: [
            channel({ id: "a", name: "#new" }),
            channel({
              id: "b",
              name: "#tested",
              failure: { reason: "unreachable", status: null, code: null, at: "2026-10-15T08:00:00.000Z" },
            }),
            channel({ id: "c", name: "#used", lastDeliveredAt: "2026-10-15T08:00:00.000Z" }),
          ],
        },
      }),
    });
    await renderWithProviders(panel({ secondaryAction: true }));
    const list = await screen.findByRole("list", { name: "Chat channels" });
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0] as HTMLElement).getByText("Not tested yet")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("Last test failed")).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText(/Pagehall could not reach Slack/)).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText("Working")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect a channel" }).className).not.toContain("bg-accent");
  });

  it("marks failing channels and says why and what to do", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
      [`GET ${base}`]: () => ({
        body: {
          items: [
            channel({
              state: "failing",
              failure: {
                reason: "unauthorized",
                status: 403,
                code: "invalid_token",
                at: "2026-10-15T08:00:00.000Z",
              },
            }),
          ],
        },
      }),
    });
    await renderWithProviders(panel());
    expect(await screen.findByText("Failing")).toBeTruthy();
    expect(screen.getByText("Slack stopped accepting messages for #ops-alerts")).toBeTruthy();
    expect(
      screen.getByText(
        "The service answered “invalid_token”. Slack refused the message. Create a new address there and paste it in Edit. Messages since then were not posted.",
      ),
    ).toBeTruthy();
  });

  it("explains why a space cannot post to chat", async () => {
    const { requests } = mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
    await renderWithProviders(panel({ unavailable: "Confidential spaces cannot post to chat channels." }));
    expect(await screen.findByText("Confidential spaces cannot post to chat channels.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect a channel" })).toBeNull();
    expect(requests.filter((request) => request.path.includes("chat-channels"))).toEqual([]);
  });
});
