import { createHash } from "node:crypto";
import pg from "pg";

export type DatabasePool = pg.Pool;

export type PoolAcquireEvent = { seconds: number; timedOut: boolean };

type Release = (release?: Error | boolean) => void;
type ConnectCallback = (error: Error | undefined, client: pg.PoolClient | undefined, done: Release) => void;

class ObservedPool extends pg.Pool {
  readonly #onAcquire: (event: PoolAcquireEvent) => void;

  constructor(config: pg.PoolConfig, onAcquire: (event: PoolAcquireEvent) => void) {
    super(config);
    this.#onAcquire = onAcquire;
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | undefined {
    const started = performance.now();
    const observe = (error: Error | undefined | null): void => {
      this.#onAcquire({
        seconds: (performance.now() - started) / 1000,
        timedOut: error?.message === "timeout exceeded when trying to connect",
      });
    };
    if (callback) {
      super.connect((error, client, done) => {
        observe(error);
        callback(error, client, done);
      });
      return undefined;
    }
    return super.connect().then(
      (client) => {
        observe(undefined);
        return client;
      },
      (error: Error) => {
        observe(error);
        throw error;
      },
    );
  }
}

export const MAX_PREPARED_STATEMENTS = 400;
export const MAX_PREPARED_PARAMETERS = 500;
export const IDLE_CONNECTION_MS = 5 * 60 * 1000;
const MAX_SEEN_STATEMENTS = 1000;

type QueryText = { text: string; name?: string | undefined; [key: string]: unknown };
type ParsedStatements = {
  parsedStatements: Record<string, string>;
  submittedNamedStatements: Record<string, string>;
};

function statementName(text: string): string {
  return `lunedo_${createHash("sha1").update(text).digest("hex").slice(0, 24)}`;
}

function touch<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key);
  map.set(key, value);
}

export function prepareRepeatedStatements(client: pg.PoolClient): void {
  const query = client.query;
  const seen = new Map<string, true>();
  const prepared = new Map<string, true>();
  const connection = () => (client as unknown as { connection: ParsedStatements }).connection;
  const release = (name: string) => {
    prepared.delete(name);
    if (connection().submittedNamedStatements[name] !== undefined) {
      prepared.set(name, true);
      return;
    }
    if (connection().parsedStatements[name] === undefined) return;
    Reflect.apply(query, client, [
      `deallocate ${name}`,
      (error: Error | null) => {
        if (error) {
          prepared.set(name, true);
          return;
        }
        delete connection().parsedStatements[name];
        delete connection().submittedNamedStatements[name];
      },
    ]);
  };
  client.query = function (this: pg.PoolClient, ...args: unknown[]) {
    const [first, values] = args;
    const parameters = Array.isArray(values) ? values : (first as { values?: unknown[] } | null)?.values;
    const config: QueryText | null =
      typeof first === "string"
        ? { text: first }
        : typeof first === "object" && first !== null && typeof (first as QueryText).text === "string"
          ? (first as QueryText)
          : null;
    if (
      config &&
      !config.name &&
      parameters &&
      parameters.length > 0 &&
      parameters.length <= MAX_PREPARED_PARAMETERS
    ) {
      const name = statementName(config.text);
      if (prepared.has(name)) {
        touch(prepared, name, true);
        args[0] = { ...config, name };
      } else if (seen.has(name)) {
        const oldest = prepared.size >= MAX_PREPARED_STATEMENTS ? prepared.keys().next().value : undefined;
        if (oldest !== undefined) release(oldest);
        prepared.set(name, true);
        args[0] = { ...config, name };
      } else {
        touch(seen, name, true);
        const forgotten = seen.size > MAX_SEEN_STATEMENTS ? seen.keys().next().value : undefined;
        if (forgotten !== undefined) seen.delete(forgotten);
      }
    }
    return Reflect.apply(query, this, args);
  } as pg.PoolClient["query"];
}

export function createDatabasePool(options: {
  connectionString: string;
  applicationName: string;
  max?: number;
  connectionTimeoutMillis?: number;
  settings?: Readonly<Record<string, string | number>>;
  onAcquire?: (event: PoolAcquireEvent) => void;
}): DatabasePool {
  const settings = Object.entries({ jit: "off", ...options.settings }).map(
    ([name, value]) => `-c ${name}=${value}`,
  );
  const config: pg.PoolConfig = {
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000,
    idleTimeoutMillis: IDLE_CONNECTION_MS,
    allowExitOnIdle: true,
    options: settings.join(" "),
  };
  const pool = options.onAcquire ? new ObservedPool(config, options.onAcquire) : new pg.Pool(config);
  pool.on("connect", prepareRepeatedStatements);
  return pool;
}

export async function pingDatabase(pool: DatabasePool): Promise<void> {
  await pool.query("select 1");
}
