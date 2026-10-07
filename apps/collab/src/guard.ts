import { validateDocument } from "@pagehall/editor-schema";
import { documentFromYDoc } from "@pagehall/editor-schema/yjs";
import * as Y from "yjs";

export type UpdateVerdict =
  | { ok: true; newClients: number[] }
  | { ok: false; reason: "invalidDocument" | "foreignClient" | "malformed"; problems: string[] };

export interface ClientOwners {
  owners(clientIds: number[]): Promise<Map<number, string>>;
}

function clientsOf(update: Uint8Array): number[] {
  const clients = new Set<number>();
  for (const struct of Y.decodeUpdate(update).structs) clients.add(struct.id.client);
  return [...clients];
}

export class DocumentGuard {
  readonly #live: Y.Doc;
  readonly #owners: ClientOwners;
  readonly #known = new Map<number, string>();
  #shadow: Y.Doc;

  constructor(live: Y.Doc, owners: ClientOwners) {
    this.#live = live;
    this.#owners = owners;
    this.#shadow = this.#copy();
    live.on("update", this.#follow);
  }

  #copy(): Y.Doc {
    const shadow = new Y.Doc({ gc: this.#live.gc });
    Y.applyUpdate(shadow, Y.encodeStateAsUpdate(this.#live));
    return shadow;
  }

  #follow = (update: Uint8Array) => {
    Y.applyUpdate(this.#shadow, update);
  };

  #reset(): void {
    this.#shadow.destroy();
    this.#shadow = this.#copy();
  }

  async check(update: Uint8Array, accountId: string): Promise<UpdateVerdict> {
    let clients: number[];
    try {
      clients = clientsOf(update);
    } catch {
      return { ok: false, reason: "malformed", problems: [] };
    }
    const unknown = clients.filter((client) => !this.#known.has(client));
    if (unknown.length > 0) {
      for (const [client, owner] of await this.#owners.owners(unknown)) this.#known.set(client, owner);
    }
    if (clients.some((client) => (this.#known.get(client) ?? accountId) !== accountId)) {
      return { ok: false, reason: "foreignClient", problems: [] };
    }
    try {
      Y.applyUpdate(this.#shadow, update);
    } catch {
      this.#reset();
      return { ok: false, reason: "malformed", problems: [] };
    }
    const result = validateDocument(documentFromYDoc(this.#shadow));
    if (!result.ok) {
      this.#reset();
      return {
        ok: false,
        reason: "invalidDocument",
        problems: [...new Set(result.problems.map((problem) => problem.code))].slice(0, 20),
      };
    }
    const newClients = clients.filter((client) => !this.#known.has(client));
    for (const client of newClients) this.#known.set(client, accountId);
    return { ok: true, newClients };
  }

  destroy(): void {
    this.#live.off("update", this.#follow);
    this.#shadow.destroy();
  }
}
