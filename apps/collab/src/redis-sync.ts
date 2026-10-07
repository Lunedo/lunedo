import type {
  afterLoadDocumentPayload,
  afterUnloadDocumentPayload,
  beforeBroadcastStatelessPayload,
  Document,
  Extension,
  Hocuspocus,
  onAwarenessUpdatePayload,
  onChangePayload,
  onConfigurePayload,
} from "@hocuspocus/server";
import type { Logger } from "@pagehall/server";
import { Redis } from "ioredis";
import { applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";

const PREFIX = "pagehall:collab:";

const kinds = {
  update: 0,
  syncRequest: 1,
  awareness: 2,
  awarenessRequest: 3,
  stateless: 4,
} as const;
type Kind = (typeof kinds)[keyof typeof kinds];

export const REDIS_ORIGIN = { source: "redis" } as const;

function isRedisOrigin(origin: unknown): boolean {
  return typeof origin === "object" && origin !== null && (origin as { source?: unknown }).source === "redis";
}

function frame(kind: Kind, node: string, payload: Uint8Array): Buffer {
  const id = Buffer.from(node, "utf8");
  return Buffer.concat([Buffer.from([kind, id.length]), id, payload]);
}

function unframe(message: Buffer): { kind: number; node: string; payload: Uint8Array } | null {
  if (message.length < 2) return null;
  const length = message[1] ?? 0;
  if (message.length < 2 + length) return null;
  return {
    kind: message[0] ?? -1,
    node: message.subarray(2, 2 + length).toString("utf8"),
    payload: new Uint8Array(message.subarray(2 + length)),
  };
}

export class RedisSync implements Extension {
  extensionName = "PagehallRedisSync";
  priority = 1000;
  readonly #publisher: Redis;
  readonly #subscriber: Redis;
  readonly #node: string;
  readonly #logger: Logger;
  #instance: Hocuspocus | undefined;

  constructor(options: { url: string; node: string; logger: Logger }) {
    this.#publisher = new Redis(options.url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    this.#subscriber = this.#publisher.duplicate();
    this.#node = options.node;
    this.#logger = options.logger;
    for (const client of [this.#publisher, this.#subscriber]) {
      client.on("error", (error: unknown) => this.#logger.warn({ err: error }, "Redis connection failed"));
    }
    this.#subscriber.on("messageBuffer", (channel: Buffer, message: Buffer) => {
      this.#receive(channel.toString("utf8").slice(PREFIX.length), message);
    });
  }

  async onConfigure({ instance }: onConfigurePayload): Promise<void> {
    this.#instance = instance;
  }

  #publish(documentName: string, kind: Kind, payload: Uint8Array): void {
    this.#publisher
      .publish(`${PREFIX}${documentName}`, frame(kind, this.#node, payload))
      .catch((error: unknown) => this.#logger.warn({ err: error }, "Publishing to Redis failed"));
  }

  async afterLoadDocument({ document, documentName }: afterLoadDocumentPayload): Promise<void> {
    await this.#subscriber.subscribe(`${PREFIX}${documentName}`);
    this.requestSync(document);
    this.#publish(documentName, kinds.awarenessRequest, new Uint8Array());
  }

  requestSync(document: Document): void {
    this.#publish(document.name, kinds.syncRequest, Y.encodeStateVector(document));
  }

  async afterUnloadDocument({ documentName }: afterUnloadDocumentPayload): Promise<void> {
    await this.#subscriber.unsubscribe(`${PREFIX}${documentName}`);
  }

  async onChange({ documentName, update, transactionOrigin }: onChangePayload): Promise<void> {
    if (isRedisOrigin(transactionOrigin)) return;
    this.#publish(documentName, kinds.update, update);
  }

  async onAwarenessUpdate({
    documentName,
    awareness,
    added,
    updated,
    removed,
    transactionOrigin,
  }: onAwarenessUpdatePayload): Promise<void> {
    if (isRedisOrigin(transactionOrigin)) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    this.#publish(documentName, kinds.awareness, encodeAwarenessUpdate(awareness, changed));
  }

  async beforeBroadcastStateless({ documentName, payload }: beforeBroadcastStatelessPayload): Promise<void> {
    this.#publish(documentName, kinds.stateless, new TextEncoder().encode(payload));
  }

  #receive(documentName: string, message: Buffer): void {
    const parsed = unframe(message);
    if (!parsed || parsed.node === this.#node) return;
    const document = this.#instance?.documents.get(documentName);
    if (!document) return;
    try {
      switch (parsed.kind) {
        case kinds.update:
          Y.applyUpdate(document, parsed.payload, REDIS_ORIGIN);
          break;
        case kinds.syncRequest:
          this.#publish(documentName, kinds.update, Y.encodeStateAsUpdate(document, parsed.payload));
          break;
        case kinds.awareness:
          applyAwarenessUpdate(document.awareness, parsed.payload, REDIS_ORIGIN);
          break;
        case kinds.awarenessRequest: {
          const clients = [...document.awareness.getStates().keys()];
          if (clients.length > 0) {
            this.#publish(documentName, kinds.awareness, encodeAwarenessUpdate(document.awareness, clients));
          }
          break;
        }
        case kinds.stateless:
          document.relayStateless(new TextDecoder().decode(parsed.payload));
          break;
      }
    } catch (error) {
      this.#logger.warn({ err: error }, "Applying a message from another collaboration node failed");
    }
  }

  async onDestroy(): Promise<void> {
    this.#subscriber.disconnect();
    this.#publisher.disconnect();
  }
}
