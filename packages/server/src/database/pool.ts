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

export const MAX_PREPARED_STATEMENTS = 500;

type QueryText = { text: string; name?: string | undefined; [key: string]: unknown };

function statementName(text: string): string {
  return `lunedo_${createHash("sha1").update(text).digest("hex").slice(0, 24)}`;
}

export function prepareRepeatedStatements(client: pg.PoolClient): void {
  const query = client.query;
  const prepared = new Set<string>();
  client.query = function (this: pg.PoolClient, ...args: unknown[]) {
    const [first, values] = args;
    const parameters = Array.isArray(values) ? values : (first as { values?: unknown[] } | null)?.values;
    const config: QueryText | null =
      typeof first === "string"
        ? { text: first }
        : typeof first === "object" && first !== null && typeof (first as QueryText).text === "string"
          ? (first as QueryText)
          : null;
    if (config && !config.name && parameters && parameters.length > 0) {
      const name = statementName(config.text);
      if (prepared.has(name) || prepared.size < MAX_PREPARED_STATEMENTS) {
        prepared.add(name);
        args[0] = { ...config, name };
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
    options: settings.join(" "),
  };
  const pool = options.onAcquire ? new ObservedPool(config, options.onAcquire) : new pg.Pool(config);
  pool.on("connect", prepareRepeatedStatements);
  return pool;
}

export async function pingDatabase(pool: DatabasePool): Promise<void> {
  await pool.query("select 1");
}
