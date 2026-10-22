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
  type AuditChangeSignal,
  accountPrincipal,
  auditScopeOf,
  clientAddress,
  DOCUMENT_CHANGES_CHANNEL,
  handleOperationsRequest,
  instanceUrlSetting,
  type MaintenanceStatus,
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
import { DocumentGuard, pageValidator, sceneValidator } from "./guard.js";
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
  WHITEBOARD_PREFIX,
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
  signalsBeforeCheck: number;
  checkedAt: number;
}

const RECHECKED_AUDIT_TARGETS = new Set(["group", "account", "organization", "roleAssignment"]);
const STORE_ORIGIN = { source: "local", skipStoreHooks: true } as const;
const REJECTED_UPDATE_TYPES = new Set([1, 2]);

const RECHECK_REASONS = ["access", "tree", "audit", "reconnect", "interval", "connected"] as const;
type RecheckReason = (typeof RECHECK_REASONS)[number];
type RecheckResult = "kept" | "sessionEnded" | "permissionRevoked" | "unavailable";

const RECHECK_PRIORITY: Record<RecheckReason, number> = {
  access: 0,
  tree: 0,
  connected: 0,
  audit: 1,
  reconnect: 1,
  interval: 2,
};
const LOWER_PRIORITY_TURN = 4;

interface Recheck {
  sessions: boolean;
  reasons: Set<RecheckReason>;
  since: number;
}

type Affected = (context: CollabContext) => boolean;

function everyone(): boolean {
  return true;
}

function inSpace(spaceId: string): Affected {
  return (context) => context.spaceId === spaceId;
}

function auditAffected(signal: AuditChangeSignal): Affected {
  if (signal.target === "account") {
    const accountId = signal.accountId;
    return accountId ? (context) => context.accountId === accountId : () => false;
  }
  if (signal.scope === "instance") return everyone;
  return (context) => context.organizationId === signal.organizationId || context.organizationId === null;
}

function priorityOf(recheck: Recheck): number {
  return Math.min(...[...recheck.reasons].map((reason) => RECHECK_PRIORITY[reason]));
}

function reasonOf(recheck: Recheck): RecheckReason {
  return RECHECK_REASONS.find((reason) => recheck.reasons.has(reason)) ?? "connected";
}

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

export type DocumentKind = "page" | "whiteboard";

const DOCUMENT_PREFIXES: Record<DocumentKind, string> = {
  page: DOCUMENT_PREFIX,
  whiteboard: WHITEBOARD_PREFIX,
};

export function maintenanceMessage(status: Pick<MaintenanceStatus, "enabled" | "message">): string {
  return JSON.stringify({ type: "maintenance", enabled: status.enabled, message: status.message });
}

export function parseDocumentName(documentName: string): { kind: DocumentKind; itemId: string } | null {
  for (const [kind, prefix] of Object.entries(DOCUMENT_PREFIXES) as [DocumentKind, string][]) {
    if (!documentName.startsWith(prefix)) continue;
    const id = documentName.slice(prefix.length);
    return isUuid(id) && id === id.toLowerCase() ? { kind, itemId: id } : null;
  }
  return null;
}

export function itemIdOf(documentName: string): string | null {
  return parseDocumentName(documentName)?.itemId ?? null;
}

function documentNamesOf(itemId: string): string[] {
  return Object.values(DOCUMENT_PREFIXES).map((prefix) => `${prefix}${itemId}`);
}

function acceptsItem(kind: DocumentKind, itemKind: string | undefined): boolean {
  return kind === "whiteboard" ? itemKind === "whiteboard" : itemKind === "page" || itemKind === "blogPost";
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
  let signals = 0;
  const pending = new Map<Connection<CollabContext>, Recheck>();
  const queues = Array.from(
    { length: Math.max(...Object.values(RECHECK_PRIORITY)) + 1 },
    () => new Set<Connection<CollabContext>>(),
  );
  const checking = new Set<Connection<CollabContext>>();
  let turns = 0;
  const concurrency = Math.max(1, Math.floor(runtime.config.database.poolSize / 2));

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
    documentName: string,
    reason: "invalidDocument" | "tooLarge" | "foreignClient" | "malformed",
    problems: string[],
    bytes: number,
  ): Promise<never> {
    const actor = accountPrincipal(context.accountId);
    const scope = auditScopeOf({ organizationId: context.organizationId });
    const recorded =
      parseDocumentName(documentName)?.kind === "whiteboard"
        ? services.audit.recordAlone({
            name: "whiteboard.updateRejected",
            actor,
            targetId: context.itemId,
            fields: {
              spaceId: context.spaceId,
              reason: reason === "invalidDocument" ? "invalidScene" : reason,
              problems,
              bytes,
            },
            scope,
          })
        : services.audit.recordAlone({
            name: "page.updateRejected",
            actor,
            targetId: context.itemId,
            fields: { spaceId: context.spaceId, reason, problems, bytes },
            scope,
          });
    await recorded.catch((error: unknown) =>
      logger.warn({ err: error }, "Recording a rejected update failed"),
    );
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

  async function locate(
    itemId: string,
  ): Promise<{ kind: string; spaceId: string; organizationId: string | null } | undefined> {
    const result = await runtime.pool.query<{
      kind: string;
      space_id: string;
      organization_id: string | null;
    }>(
      `select t.kind, t.space_id, s.organization_id from tree_items t join spaces s on s.id = t.space_id
      where t.id = $1`,
      [itemId],
    );
    const row = result.rows[0];
    return row && { kind: row.kind, spaceId: row.space_id, organizationId: row.organization_id };
  }

  async function verdict(context: CollabContext, sessions: boolean): Promise<RecheckResult> {
    if (sessions) {
      const session = await services.sessions.resolve(context.sessionToken);
      if (session?.id !== context.sessionId || session.kind !== "full") return "sessionEnded";
    }
    const location = await locate(context.itemId);
    if (location) {
      context.spaceId = location.spaceId;
      context.organizationId = location.organizationId;
    }
    return (await may(context, "item.edit")) ? "kept" : "permissionRevoked";
  }

  async function check(connection: Connection<CollabContext>, recheck: Recheck): Promise<RecheckResult> {
    const context = connection.context;
    let result: RecheckResult;
    try {
      result = await verdict(context, recheck.sessions);
    } catch (error) {
      logger.warn({ err: error }, "Checking a collaboration connection failed");
      result = "unavailable";
    }
    logger.info(
      {
        itemId: context.itemId,
        accountId: context.accountId,
        node,
        reason: reasonOf(recheck),
        durationMs: Date.now() - recheck.since,
        result,
      },
      "Collaboration permission rechecked",
    );
    if (result !== "kept") connection.close(closeReasons[result]);
    return result;
  }

  function isOpen(connection: Connection<CollabContext>): boolean {
    return connection.document.connections.has(connection);
  }

  function enqueue(connection: Connection<CollabContext>): void {
    const recheck = pending.get(connection);
    if (!recheck || checking.has(connection)) return;
    for (const queue of queues) queue.delete(connection);
    queues[priorityOf(recheck)]?.add(connection);
  }

  function oldestOf(
    candidates: Set<Connection<CollabContext>>[],
  ): Set<Connection<CollabContext>> | undefined {
    let oldest: Set<Connection<CollabContext>> | undefined;
    let oldestSince = Number.POSITIVE_INFINITY;
    for (const queue of candidates) {
      const [first] = queue;
      const since = first && pending.get(first)?.since;
      if (since !== undefined && since < oldestSince) {
        oldest = queue;
        oldestSince = since;
      }
    }
    return oldest;
  }

  function next(): Connection<CollabContext> | undefined {
    turns += 1;
    const lower = turns % LOWER_PRIORITY_TURN === 0 ? oldestOf(queues.slice(1)) : undefined;
    const queue = lower ?? queues.find((candidate) => candidate.size > 0);
    const [first] = queue ?? [];
    if (first) queue?.delete(first);
    return first;
  }

  function release(connection: Connection<CollabContext>, result: RecheckResult): void {
    checking.delete(connection);
    if (result === "kept" && isOpen(connection)) enqueue(connection);
    else pending.delete(connection);
    drain();
  }

  function drain(): void {
    while (!destroyed && checking.size < concurrency) {
      const connection = next();
      if (!connection) return;
      const recheck = pending.get(connection);
      pending.delete(connection);
      if (!recheck || !isOpen(connection)) continue;
      checking.add(connection);
      void check(connection, recheck).then(
        (result) => release(connection, result),
        (error: unknown) => {
          logger.warn({ err: error }, "Checking a collaboration connection failed");
          release(connection, "unavailable");
          connection.close(closeReasons.unavailable);
        },
      );
    }
  }

  function scheduleRecheck(
    reason: RecheckReason,
    affected: Affected = everyone,
    options: { sessions?: boolean } = {},
  ): void {
    if (destroyed) return;
    signals += 1;
    const sessions = options.sessions ?? (reason === "interval" || reason === "reconnect");
    const since = Date.now();
    for (const document of instance.documents.values()) {
      for (const connection of document.getConnections()) {
        if (!affected(connection.context)) continue;
        const earlier = pending.get(connection);
        pending.set(connection, {
          sessions: sessions || (earlier?.sessions ?? false),
          reasons: new Set([...(earlier?.reasons ?? []), reason]),
          since: earlier?.since ?? since,
        });
        enqueue(connection);
      }
    }
    drain();
  }

  async function storedState(kind: DocumentKind, itemId: string): Promise<Uint8Array | null> {
    return kind === "whiteboard"
      ? ((await services.whiteboards.stored(itemId))?.state ?? null)
      : services.documents.state(itemId);
  }

  async function mergeStored(document: Document, kind: DocumentKind, itemId: string): Promise<void> {
    const state = await storedState(kind, itemId);
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
    async onAuthenticate({ requestHeaders, documentName, connectionConfig }): Promise<CollabContext> {
      try {
        const signalsBeforeCheck = signals;
        const checkedAt = Date.now();
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
        const parsed = parseDocumentName(documentName);
        const itemId = parsed?.itemId ?? null;
        const location = itemId ? await locate(itemId) : undefined;
        const context: CollabContext = {
          accountId: session.accountId,
          sessionId: session.id,
          sessionToken: token,
          itemId: itemId ?? "",
          spaceId: location?.spaceId ?? "",
          organizationId: location?.organizationId ?? null,
          signalsBeforeCheck,
          checkedAt,
        };
        if (!parsed || !acceptsItem(parsed.kind, location?.kind) || !(await may(context, "item.view"))) {
          throw new Refusal("pageNotFound");
        }
        if (!(await may(context, "item.edit"))) throw new Refusal("noEditPermission");
        if ((await services.maintenance.status()).enabled) connectionConfig.readOnly = true;
        return context;
      } catch (error) {
        if (error instanceof Refusal) throw { reason: error.reason };
        logger.warn({ err: error }, "Authenticating a collaboration connection failed");
        throw { reason: "permission-denied" };
      }
    },
    async onLoadDocument({ document, documentName }) {
      const parsed = parseDocumentName(documentName);
      if (!parsed) throw { reason: "pageNotFound" };
      const { kind, itemId } = parsed;
      if (kind === "whiteboard") {
        const stored = await services.whiteboards.stored(itemId);
        if (!stored) throw { reason: "pageNotFound" };
        Y.applyUpdate(document, stored.state, STORE_ORIGIN);
      } else {
        const stored = await services.documents.stored(itemId);
        if (!stored) throw { reason: "pageNotFound" };
        Y.applyUpdate(document, stored.state, STORE_ORIGIN);
        migrateYDoc(document, stored.schemaVersion, STORE_ORIGIN);
      }
      guards.get(documentName)?.destroy();
      guards.set(
        documentName,
        new DocumentGuard(
          document,
          {
            owners: async (clients) => {
              const result = await runtime.pool.query<{ client_id: string; account_id: string }>(
                "select client_id, account_id from collaboration_clients where item_id = $1 and client_id = any($2)",
                [itemId, clients],
              );
              return new Map(result.rows.map((row) => [Number(row.client_id), row.account_id]));
            },
          },
          kind === "whiteboard" ? sceneValidator : pageValidator,
        ),
      );
    },
    async beforeHandleMessage({ connection, update, context, documentName }) {
      let bucket = buckets.get(connection);
      if (!bucket) {
        bucket = new Bucket();
        buckets.set(connection, bucket);
      }
      if (!bucket.take()) throw closeReasons.tooManyMessages;
      if (update.byteLength > MAX_UPDATE_BYTES) {
        await reject(context as CollabContext, documentName, "tooLarge", [], update.byteLength);
      }
      if (update.byteLength > MAX_AWARENESS_BYTES) {
        const message = new IncomingMessage(update);
        message.readVarString();
        if (message.readVarUint() === MessageType.Awareness) {
          await reject(context as CollabContext, documentName, "tooLarge", [], update.byteLength);
        }
      }
    },
    async beforeSync({ type, payload, context, documentName }) {
      if (!REJECTED_UPDATE_TYPES.has(type)) return;
      const collab = context as CollabContext;
      const guard = guards.get(documentName);
      if (!guard) throw closeReasons.updateRejected;
      const verdict = await guard.check(payload, collab.accountId);
      if (!verdict.ok)
        return reject(collab, documentName, verdict.reason, verdict.problems, payload.byteLength);
      for (const client of verdict.newClients) {
        await recordClient(runtime.database, collab.itemId, client, collab.accountId);
      }
      lastEditors.set(documentName, collab.accountId);
    },
    async onStoreDocument(payload: onStoreDocumentPayload<CollabContext>) {
      const { document, documentName } = payload;
      const parsed = parseDocumentName(documentName);
      if (!parsed) return;
      const { kind, itemId } = parsed;
      try {
        await mergeStored(document, kind, itemId);
        const stateVector = Y.encodeStateVector(document);
        const actorId = lastEditors.get(documentName) ?? null;
        const revision =
          kind === "whiteboard"
            ? await services.whiteboards.store(itemId, document, { actorId })
            : await services.documents.store(itemId, document, { actorId });
        document.broadcastStateless(
          JSON.stringify({
            type: "saved",
            revision,
            stateVector: Buffer.from(stateVector).toString("base64"),
          }),
        );
      } catch (error) {
        logger.warn({ err: error, itemId, kind }, "Storing a document failed");
        document.broadcastStateless(JSON.stringify({ type: "saveFailed" }));
        setTimeout(() => {
          if (!destroyed && instance.documents.get(documentName) === document) {
            void instance.storeDocumentHooks(document, payload);
          }
        }, STORE_RETRY_MS).unref();
        throw error;
      }
    },
    async connected({ documentName, instance: server, connection }) {
      const maintenance = await services.maintenance.status();
      connection.readOnly = maintenance.enabled;
      connection.sendStateless(maintenanceMessage(maintenance));
      const { signalsBeforeCheck, checkedAt } = connection.context as CollabContext;
      if (signalsBeforeCheck !== signals) {
        await check(connection, { sessions: true, reasons: new Set(["connected"]), since: checkedAt });
      }
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
      const parsed = parseDocumentName(documentName);
      if (!parsed) return;
      const { kind, itemId } = parsed;
      const ended =
        kind === "whiteboard"
          ? services.whiteboards.endSession(itemId, node)
          : services.versions.endSession(itemId, node);
      await ended.catch((error: unknown) =>
        logger.warn({ err: error, itemId }, "Ending an editing session failed"),
      );
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
  services.maintenance.onChange((status) => {
    for (const document of instance.documents.values()) {
      for (const connection of document.getConnections()) {
        connection.readOnly = status.enabled;
        connection.sendStateless(maintenanceMessage(status));
      }
    }
  });
  endpoints.metrics.observeCollaboration(() => ({
    connections: instance.getConnectionsCount(),
    documents: instance.getDocumentsCount(),
  }));

  const timer = setInterval(() => {
    scheduleRecheck("interval");
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
      for (const name of documentNamesOf(signal.itemId)) {
        const document = instance.documents.get(name);
        const parsed = parseDocumentName(name);
        if (!document || document.isLoading || !parsed) continue;
        mergeStored(document, parsed.kind, signal.itemId).catch((error: unknown) =>
          logger.warn({ err: error }, "Loading a document changed elsewhere failed"),
        );
      }
    }),
    runtime.listener.listen(SPACE_CHANGES_CHANNEL, (raw) => {
      const signal = parseSpaceChangeSignal(raw);
      if (signal && (signal.kind === "access" || signal.kind === "tree")) {
        scheduleRecheck(signal.kind, inSpace(signal.spaceId));
      }
    }),
    runtime.listener.listen(AUDIT_CHANGES_CHANNEL, (raw) => {
      const signal = parseAuditChangeSignal(raw);
      if (signal && RECHECKED_AUDIT_TARGETS.has(signal.target)) {
        scheduleRecheck("audit", auditAffected(signal), { sessions: signal.target === "account" });
      }
    }),
  ]);
  runtime.listener.onReconnect(() => scheduleRecheck("reconnect"));
  return server;
}
