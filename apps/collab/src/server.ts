import {
  type Connection,
  type Document,
  type Extension,
  IncomingMessage,
  MessageType,
  type onStoreDocumentPayload,
  Server,
} from "@hocuspocus/server";
import { migrateYDoc } from "@pagehall/editor-schema/yjs";
import {
  AUDIT_CHANGES_CHANNEL,
  accountPrincipal,
  auditScopeOf,
  clientAddress,
  DOCUMENT_CHANGES_CHANNEL,
  handleOperationsRequest,
  instanceUrlSetting,
  type OperationsEndpoints,
  parseAuditChangeSignal,
  parseDocumentChangeSignal,
  parseSpaceChangeSignal,
  recordClient,
  SESSION_COOKIE,
  type ServerRuntime,
  SPACE_CHANGES_CHANNEL,
  trustedProxyList,
} from "@pagehall/server";
import { isUuid } from "@pagehall/shared";
import * as Y from "yjs";
import { DocumentGuard } from "./guard.js";
import {
  CLIENT_ADDRESS_HEADER,
  COLLAB_PATH,
  CONNECTIONS_PER_ACCOUNT_PER_MINUTE,
  CONNECTIONS_PER_ADDRESS_PER_MINUTE,
  closeReasons,
  DOCUMENT_PREFIX,
  MAX_AWARENESS_BYTES,
  MAX_FRAME_BYTES,
  MAX_UPDATE_BYTES,
  MESSAGE_BURST,
  MESSAGES_PER_SECOND,
  RECHECK_INTERVAL_MS,
  type RefusalReason,
  STORE_DEBOUNCE_MS,
  STORE_MAX_DEBOUNCE_MS,
  STORE_RETRY_MS,
} from "./limits.js";
import { RedisSync } from "./redis-sync.js";

export type CollabRuntime = Pick<
  ServerRuntime,
  "services" | "settings" | "pool" | "database" | "listener" | "config" | "logger"
>;

export interface CollabContext {
  accountId: string;
  sessionId: string;
  sessionToken: string;
  itemId: string;
  spaceId: string;
  organizationId: string | null;
}

const RECHECKED_AUDIT_TARGETS = new Set(["group", "account", "organization", "roleAssignment"]);
const STORE_ORIGIN = { source: "local", skipStoreHooks: true } as const;
const REJECTED_UPDATE_TYPES = new Set([1, 2]);

class Refusal {
  constructor(readonly reason: RefusalReason) {}
}

class Bucket {
  #tokens = MESSAGE_BURST;
  #last = Date.now();

  take(): boolean {
    const now = Date.now();
    this.#tokens = Math.min(MESSAGE_BURST, this.#tokens + ((now - this.#last) / 1000) * MESSAGES_PER_SECOND);
    this.#last = now;
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
}

function cookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator !== -1 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export function itemIdOf(documentName: string): string | null {
  if (!documentName.startsWith(DOCUMENT_PREFIX)) return null;
  const id = documentName.slice(DOCUMENT_PREFIX.length);
  return isUuid(id) && id === id.toLowerCase() ? id : null;
}

export async function createCollabServer(options: {
  host: string;
  port: number;
  endpoints: OperationsEndpoints;
  runtime: CollabRuntime;
  redisUrl?: string | undefined;
}): Promise<Server<CollabContext>> {
  const { endpoints, runtime } = options;
  const { services, logger } = runtime;
  const proxies = trustedProxyList(runtime.config.trustedProxies, { loopback: true });
  const guards = new Map<string, DocumentGuard>();
  const node = services.documents.origin;
  const lastEditors = new Map<string, string>();
  const buckets = new WeakMap<Connection<CollabContext>, Bucket>();
  const redis = options.redisUrl
    ? new RedisSync({ url: options.redisUrl, node: services.documents.origin, logger })
    : undefined;
  let destroyed = false;
  let recheckRunning: Promise<void> | undefined;
  let recheckQueued: { sessions: boolean } | undefined;

  async function instanceOrigin(): Promise<string | null> {
    const stored = await runtime.settings.get(instanceUrlSetting, {});
    const url = stored || runtime.config.instanceUrl;
    if (!url) return null;
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  async function allowed(address: string, key: string, limit: number): Promise<boolean> {
    return (await services.rateLimiter.consume(`collab:${key}:${address}`, limit, 60)).allowed;
  }

  async function reject(
    context: CollabContext,
    reason: "invalidDocument" | "tooLarge" | "foreignClient" | "malformed",
    problems: string[],
    bytes: number,
  ): Promise<never> {
    await services.audit
      .recordAlone({
        name: "page.updateRejected",
        actor: accountPrincipal(context.accountId),
        targetId: context.itemId,
        fields: { spaceId: context.spaceId, reason, problems, bytes },
        scope: auditScopeOf({ organizationId: context.organizationId }),
      })
      .catch((error: unknown) => logger.warn({ err: error }, "Recording a rejected update failed"));
    logger.info({ itemId: context.itemId, reason }, "Collaborative update rejected");
    throw closeReasons.updateRejected;
  }

  async function may(context: CollabContext, action: "item.view" | "item.edit"): Promise<boolean> {
    const decision = await services.authorization.explain(
      accountPrincipal(context.accountId),
      action,
      { type: "item", id: context.itemId },
      { fresh: true },
    );
    return decision.allowed;
  }

  async function recheck(sessions: boolean): Promise<void> {
    for (const document of instance.documents.values()) {
      for (const connection of document.getConnections()) {
        const context = connection.context as CollabContext;
        try {
          if (sessions) {
            const session = await services.sessions.resolve(context.sessionToken);
            if (session?.id !== context.sessionId || session.kind !== "full") {
              connection.close(closeReasons.sessionEnded);
              continue;
            }
          }
          if (!(await may(context, "item.edit"))) connection.close(closeReasons.permissionRevoked);
        } catch (error) {
          logger.warn({ err: error }, "Checking a collaboration connection failed");
          connection.close(closeReasons.unavailable);
        }
      }
    }
  }

  function scheduleRecheck(sessions: boolean): void {
    if (destroyed) return;
    if (recheckRunning) {
      recheckQueued = { sessions: sessions || (recheckQueued?.sessions ?? false) };
      return;
    }
    recheckRunning = recheck(sessions).finally(() => {
      recheckRunning = undefined;
      const queued = recheckQueued;
      recheckQueued = undefined;
      if (queued) scheduleRecheck(queued.sessions);
    });
  }

  async function mergeStored(document: Document, itemId: string): Promise<void> {
    const state = await services.documents.state(itemId);
    if (state) Y.applyUpdate(document, state, STORE_ORIGIN);
  }

  const pagehall: Extension = {
    extensionName: "Pagehall",
    async onUpgrade({ request, socket }) {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (path !== COLLAB_PATH) {
        socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return Promise.reject();
      }
      request.headers[CLIENT_ADDRESS_HEADER] = clientAddress(
        request.socket.remoteAddress,
        request.headers["x-forwarded-for"],
        proxies,
      );
    },
    async onRequest({ request, response }) {
      if (!(await handleOperationsRequest(request, response, endpoints))) response.writeHead(404).end();
      return Promise.reject();
    },
    async onAuthenticate({ requestHeaders, documentName }): Promise<CollabContext> {
      try {
        const address = requestHeaders.get(CLIENT_ADDRESS_HEADER) ?? "unknown";
        if (!(await allowed(address, "address", CONNECTIONS_PER_ADDRESS_PER_MINUTE))) {
          throw new Refusal("tooManyConnections");
        }
        if (requestHeaders.has("authorization")) throw new Refusal("tokenNotAllowed");
        const expected = await instanceOrigin();
        if (!expected || requestHeaders.get("origin") !== expected) throw new Refusal("originNotAllowed");
        const token = cookie(requestHeaders.get("cookie"), SESSION_COOKIE);
        const session = token ? await services.sessions.resolve(token) : null;
        if (!token || !session || session.kind !== "full") throw new Refusal("notSignedIn");
        if (!(await allowed(session.accountId, "account", CONNECTIONS_PER_ACCOUNT_PER_MINUTE))) {
          throw new Refusal("tooManyConnections");
        }
        const itemId = itemIdOf(documentName);
        const item = itemId
          ? await runtime.pool.query<{ kind: string; space_id: string; organization_id: string | null }>(
              `select t.kind, t.space_id, s.organization_id from tree_items t join spaces s on s.id = t.space_id
              where t.id = $1`,
              [itemId],
            )
          : undefined;
        const row = item?.rows[0];
        const context: CollabContext = {
          accountId: session.accountId,
          sessionId: session.id,
          sessionToken: token,
          itemId: itemId ?? "",
          spaceId: row?.space_id ?? "",
          organizationId: row?.organization_id ?? null,
        };
        if ((row?.kind !== "page" && row?.kind !== "blogPost") || !(await may(context, "item.view"))) {
          throw new Refusal("pageNotFound");
        }
        if (!(await may(context, "item.edit"))) throw new Refusal("noEditPermission");
        return context;
      } catch (error) {
        if (error instanceof Refusal) throw { reason: error.reason };
        logger.warn({ err: error }, "Authenticating a collaboration connection failed");
        throw { reason: "permission-denied" };
      }
    },
    async onLoadDocument({ document, documentName }) {
      const itemId = itemIdOf(documentName);
      const stored = itemId ? await services.documents.stored(itemId) : null;
      if (!itemId || !stored) throw { reason: "pageNotFound" };
      Y.applyUpdate(document, stored.state, STORE_ORIGIN);
      migrateYDoc(document, stored.schemaVersion, STORE_ORIGIN);
      guards.get(documentName)?.destroy();
      guards.set(
        documentName,
        new DocumentGuard(document, {
          owners: async (clients) => {
            const result = await runtime.pool.query<{ client_id: string; account_id: string }>(
              "select client_id, account_id from collaboration_clients where item_id = $1 and client_id = any($2)",
              [itemId, clients],
            );
            return new Map(result.rows.map((row) => [Number(row.client_id), row.account_id]));
          },
        }),
      );
    },
    async beforeHandleMessage({ connection, update, context }) {
      let bucket = buckets.get(connection);
      if (!bucket) {
        bucket = new Bucket();
        buckets.set(connection, bucket);
      }
      if (!bucket.take()) throw closeReasons.tooManyMessages;
      if (update.byteLength > MAX_UPDATE_BYTES) {
        await reject(context as CollabContext, "tooLarge", [], update.byteLength);
      }
      if (update.byteLength > MAX_AWARENESS_BYTES) {
        const message = new IncomingMessage(update);
        message.readVarString();
        if (message.readVarUint() === MessageType.Awareness) {
          await reject(context as CollabContext, "tooLarge", [], update.byteLength);
        }
      }
    },
    async beforeSync({ type, payload, context, documentName }) {
      if (!REJECTED_UPDATE_TYPES.has(type)) return;
      const collab = context as CollabContext;
      const guard = guards.get(documentName);
      if (!guard) throw closeReasons.updateRejected;
      const verdict = await guard.check(payload, collab.accountId);
      if (!verdict.ok) return reject(collab, verdict.reason, verdict.problems, payload.byteLength);
      for (const client of verdict.newClients) {
        await recordClient(runtime.database, collab.itemId, client, collab.accountId);
      }
      lastEditors.set(documentName, collab.accountId);
    },
    async onStoreDocument(payload: onStoreDocumentPayload<CollabContext>) {
      const { document, documentName } = payload;
      const itemId = itemIdOf(documentName);
      if (!itemId) return;
      try {
        await mergeStored(document, itemId);
        const stateVector = Y.encodeStateVector(document);
        const revision = await services.documents.store(itemId, document, {
          actorId: lastEditors.get(documentName) ?? null,
        });
        document.broadcastStateless(
          JSON.stringify({
            type: "saved",
            revision,
            stateVector: Buffer.from(stateVector).toString("base64"),
          }),
        );
      } catch (error) {
        logger.warn({ err: error, itemId }, "Storing a page failed");
        document.broadcastStateless(JSON.stringify({ type: "saveFailed" }));
        setTimeout(() => {
          if (!destroyed && instance.documents.get(documentName) === document) {
            void instance.storeDocumentHooks(document, payload);
          }
        }, STORE_RETRY_MS).unref();
        throw error;
      }
    },
    async connected({ documentName, instance: server }) {
      const itemId = itemIdOf(documentName);
      const document = server.documents.get(documentName);
      if (!itemId || !document) return;
      await services.versions
        .touchPresence(itemId, node, document.getConnectionsCount())
        .catch((error: unknown) => logger.warn({ err: error }, "Recording presence failed"));
    },
    async onDisconnect({ documentName, clientsCount }) {
      const itemId = itemIdOf(documentName);
      if (!itemId || clientsCount === 0) return;
      await services.versions
        .touchPresence(itemId, node, clientsCount)
        .catch((error: unknown) => logger.warn({ err: error }, "Recording presence failed"));
    },
    async afterUnloadDocument({ documentName }) {
      guards.get(documentName)?.destroy();
      guards.delete(documentName);
      lastEditors.delete(documentName);
      const itemId = itemIdOf(documentName);
      if (!itemId) return;
      await services.versions
        .endSession(itemId, node)
        .catch((error: unknown) => logger.warn({ err: error, itemId }, "Ending an editing session failed"));
    },
    async onDestroy() {
      destroyed = true;
      clearInterval(timer);
    },
  };

  const server = new Server<CollabContext>({
    name: "pagehall-collab",
    port: options.port,
    address: options.host,
    quiet: true,
    stopOnSignals: false,
    debounce: STORE_DEBOUNCE_MS,
    maxDebounce: STORE_MAX_DEBOUNCE_MS,
    websocketOptions: { maxPayload: MAX_FRAME_BYTES },
    extensions: [pagehall, ...(redis ? [redis] : [])],
  });
  const instance = server.hocuspocus;

  const timer = setInterval(() => {
    scheduleRecheck(true);
    const open = [...instance.documents.keys()].map(itemIdOf).filter((id): id is string => id !== null);
    services.versions
      .heartbeat(node, open)
      .catch((error: unknown) => logger.warn({ err: error }, "Recording presence failed"));
    for (const document of instance.documents.values()) redis?.requestSync(document);
  }, RECHECK_INTERVAL_MS);
  timer.unref();

  await Promise.all([
    runtime.listener.listen(DOCUMENT_CHANGES_CHANNEL, (raw) => {
      const signal = parseDocumentChangeSignal(raw);
      if (destroyed || !signal || signal.origin === services.documents.origin) return;
      const document = instance.documents.get(`${DOCUMENT_PREFIX}${signal.itemId}`);
      if (!document || document.isLoading) return;
      mergeStored(document, signal.itemId).catch((error: unknown) =>
        logger.warn({ err: error }, "Loading a page changed elsewhere failed"),
      );
    }),
    runtime.listener.listen(SPACE_CHANGES_CHANNEL, (raw) => {
      const signal = parseSpaceChangeSignal(raw);
      if (signal && (signal.kind === "access" || signal.kind === "tree")) scheduleRecheck(false);
    }),
    runtime.listener.listen(AUDIT_CHANGES_CHANNEL, (raw) => {
      const signal = parseAuditChangeSignal(raw);
      if (signal && RECHECKED_AUDIT_TARGETS.has(signal.target)) scheduleRecheck(false);
    }),
  ]);
  runtime.listener.onReconnect(() => scheduleRecheck(true));
  return server;
}
