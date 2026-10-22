import { accountPrincipal, SYSTEM } from "@lunedo/server";
import { testDatabaseBaseUrl } from "@lunedo/server/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  appendParagraph,
  type Client,
  type Cluster,
  connect,
  createCluster,
  type Node,
  signIn,
  waitFor,
} from "./harness.testing.js";

const baseUrl = testDatabaseBaseUrl();

function text(doc: Y.Doc): string {
  return doc.getXmlFragment("default").toString();
}

describe.skipIf(!baseUrl)("the collaboration server during maintenance", () => {
  let cluster: Cluster;
  let first: Node;
  let second: Node;
  let token: string;
  let itemId: string;
  const clients: Client[] = [];

  beforeAll(async () => {
    cluster = await createCluster(baseUrl ?? "", 2);
    first = await cluster.node();
    second = await cluster.node();
    const organization = await cluster.fixtures.organization();
    const admin = await cluster.fixtures.member(organization.id);
    const space = await cluster.fixtures.space(organization.id, admin);
    const item = await first.runtime.services.tree.create(accountPrincipal(admin), space.id, {
      kind: "page",
      title: "Maintenance",
      mode: "live",
      placement: { parentId: null },
    });
    itemId = item.id;
    token = await signIn(first.runtime, admin);
  }, 60_000);

  afterEach(async () => {
    await first.runtime.services.maintenance.set(SYSTEM, { enabled: false });
    for (const client of clients.splice(0)) client.destroy();
  });

  afterAll(async () => {
    await cluster?.close();
  }, 30_000);

  function open(node: Node): Client {
    const client = connect(node.url, itemId, { token });
    clients.push(client);
    return client;
  }

  it("switches open editors on every node to read-only with the message and back", async () => {
    const editing = open(first);
    const watching = open(second);
    await Promise.all([editing.authenticated, watching.authenticated]);

    await first.runtime.services.maintenance.set(SYSTEM, { enabled: true, message: "Back at 18:00" });
    await waitFor(() =>
      [editing, watching].every((client) =>
        client.stateless.some((message) => message.type === "maintenance" && message.enabled === true),
      ),
    );
    expect(watching.stateless.at(-1)).toEqual({
      type: "maintenance",
      enabled: true,
      message: "Back at 18:00",
    });

    appendParagraph(editing.doc, "written during maintenance");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(text(watching.doc)).not.toContain("written during maintenance");
    const stored = first.server.hocuspocus.documents.get(`page:${itemId}`);
    expect(stored ? text(stored) : "").not.toContain("written during maintenance");

    await first.runtime.services.maintenance.set(SYSTEM, { enabled: false });
    await waitFor(() => watching.stateless.at(-1)?.enabled === false);
    const fresh = open(second);
    await fresh.authenticated;
    appendParagraph(fresh.doc, "written afterwards");
    await waitFor(() => text(watching.doc).includes("written afterwards"));
  });

  it("tells a reconnecting editor that maintenance is off, also when it missed the message", async () => {
    await first.runtime.services.maintenance.set(SYSTEM, { enabled: true, message: "" });
    await first.runtime.services.maintenance.set(SYSTEM, { enabled: false });
    const reconnected = open(second);
    await reconnected.authenticated;
    await waitFor(() => reconnected.stateless.some((message) => message.type === "maintenance"));
    expect(reconnected.stateless.find((message) => message.type === "maintenance")).toEqual({
      type: "maintenance",
      enabled: false,
      message: "",
    });
  });

  it("opens documents read-only while maintenance is on", async () => {
    await first.runtime.services.maintenance.set(SYSTEM, { enabled: true, message: "" });
    const late = open(second);
    const reader = open(first);
    await Promise.all([late.authenticated, reader.authenticated]);
    await waitFor(() =>
      late.stateless.some((message) => message.type === "maintenance" && message.enabled === true),
    );
    appendParagraph(late.doc, "late change");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(text(reader.doc)).not.toContain("late change");
  });
});
