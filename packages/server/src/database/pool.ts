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

export function createDatabasePool(options: {
  connectionString: string;
  applicationName: string;
  max?: number;
  onAcquire?: (event: PoolAcquireEvent) => void;
}): DatabasePool {
  const config: pg.PoolConfig = {
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5000,
  };
  return options.onAcquire ? new ObservedPool(config, options.onAcquire) : new pg.Pool(config);
}

export async function pingDatabase(pool: DatabasePool): Promise<void> {
  await pool.query("select 1");
}
