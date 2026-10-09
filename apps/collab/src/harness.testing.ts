import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import type { Server } from "@hocuspocus/server";
import { createServerRuntime, Metrics, SESSION_COOKIE, type ServerRuntime } from "@pagehall/server";
import { createMigratedDatabase, spaceFixtures, type TemporaryDatabase } from "@pagehall/server/testing";
import WebSocket from "ws";
import * as Y from "yjs";
import { type CollabContext, createCollabServer } from "./server.js";

export const ORIGIN = "https://pagehall.test";

export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the condition");
}

export interface Node {
  runtime: ServerRuntime;
  server: Server<CollabContext>;
  url: string;
}

export interface Cluster {
  database: TemporaryDatabase;
  runtimes: ServerRuntime[];
  nodes: Node[];
  fixtures: ReturnType<typeof spaceFixtures>;
  node(options?: { redisUrl?: string }): Promise<Node>;
  close(): Promise<void>;
}

const CLOSE_WAIT_MS = 5000;

export async function createCluster(baseUrl: string, runtimes = 2): Promise<Cluster> {
  const database = await createMigratedDatabase(baseUrl, "pagehall_collab_test");
  const dataDir = mkdtempSync(path.join(tmpdir(), "pagehall-collab-"));
  const env = {
    PAGEHALL_DATABASE_URL: database.url,
    PAGEHALL_SECRETS_DIR: path.join(dataDir, "secrets"),
    PAGEHALL_FILES_DIR: dataDir,
    PAGEHALL_LOG_LEVEL: "silent",
    PAGEHALL_DATABASE_POOL_SIZE: "6",
    PAGEHALL_INSTANCE_URL: ORIGIN,
  };
  const started: ServerRuntime[] = [];
  for (let index = 0; index < runtimes; index++) {
    started.push(await createServerRuntime({ role: "collab", env }));
  }
  const first = started[0] as ServerRuntime;
  const nodes: Node[] = [];
  let next = 0;
  return {
    database,
    runtimes: started,
    nodes,
    fixtures: spaceFixtures(() => ({ database: first.database, services: first.services })),
    async node(options = {}) {
      const runtime = started[next % started.length] as ServerRuntime;
      next += 1;
      const server = await createCollabServer({
        host: "127.0.0.1",
        port: 0,
        endpoints: {
          ready: runtime.readiness,
          logger: runtime.logger,
          metrics: new Metrics("collab"),
          metricsToken: "collab-token",
        },
        runtime,
        redisUrl: options.redisUrl,
      });
      await server.listen();
      const node = { runtime, server, url: `ws://127.0.0.1:${server.address.port}/collab` };
      nodes.push(node);
      return node;
    },
    async close() {
      await Promise.all(
        nodes.map((node) =>
          Promise.race([node.server.destroy(), new Promise((resolve) => setTimeout(resolve, CLOSE_WAIT_MS))]),
        ),
      );
      for (const runtime of started) await runtime.close();
      await database.drop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function signIn(runtime: ServerRuntime, accountId: string): Promise<string> {
  const { token } = await runtime.database.transaction((tx) =>
    runtime.services.sessions.create(tx, { accountId, kind: "full", methods: ["password"], client: {} }),
  );
  return token;
}

export interface Client {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
  closeReasons: string[];
  stateless: { type: string; revision?: number; stateVector?: string }[];
  authenticated: Promise<void>;
  destroy(): void;
}

export function connect(
  url: string,
  itemId: string,
  options: { token?: string; origin?: string | null; headers?: Record<string, string>; doc?: Y.Doc } = {},
): Client {
  const headers: Record<string, string> = { ...options.headers };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.token) headers.cookie = `${SESSION_COOKIE}=${options.token}`;
  class HeaderWebSocket extends WebSocket {
    constructor(address: string) {
      super(address, { headers });
    }
  }
  const doc = options.doc ?? new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: HeaderWebSocket });
  const closeReasons: string[] = [];
  const stateless: Client["stateless"] = [];
  let settle: { resolve: () => void; reject: (reason: Error) => void } | undefined;
  const authenticated = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `page:${itemId}`,
    document: doc,
    token: "session",
    onSynced: () => settle?.resolve(),
    onAuthenticationFailed: ({ reason }) => settle?.reject(new Error(reason)),
    onClose: ({ event }) => {
      if (event.reason) closeReasons.push(event.reason);
    },
    onStateless: ({ payload }) => stateless.push(JSON.parse(payload) as Client["stateless"][number]),
  });
  provider.attach();
  authenticated.catch(() => undefined);
  return {
    doc,
    provider,
    socket,
    closeReasons,
    stateless,
    authenticated,
    destroy() {
      provider.destroy();
      socket.destroy();
    },
  };
}

export function appendParagraph(doc: Y.Doc, text: string): void {
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("default").push([paragraph]);
}
