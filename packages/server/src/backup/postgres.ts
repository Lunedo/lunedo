import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";

/** Access to the database part of a backup. */
export interface DatabaseArchiver {
  /** Streams a dump of the whole database. */
  dump(): Readable;
  /**
   * Loads a dump produced by `dump` in a single transaction. With `replaceExisting`, all
   * application schemas are dropped first in the same transaction. Nothing is changed when
   * the promise rejects.
   */
  restore(dump: Readable, options: { replaceExisting: boolean }): Promise<void>;
  /** True when the database contains no tables outside the system schemas. */
  isEmpty(): Promise<boolean>;
}

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];
const SYSTEM_SCHEMA_LIST = SYSTEM_SCHEMAS.map((schema) => `'${schema}'`).join(", ");

const DROP_SCHEMAS = `do $$
declare
  name text;
begin
  for name in select nspname from pg_namespace
    where nspname not in (${SYSTEM_SCHEMA_LIST}) and nspname not like 'pg\\_%'
  loop
    execute format('drop schema %I cascade', name);
  end loop;
end $$;
create schema public;
`;

export class BackupConfigurationError extends Error {
  override name = "BackupConfigurationError";

  constructor(message: string) {
    super(`LUNEDO_DATABASE_URL: ${message}`);
  }
}

const SSL_MODES = ["disable", "prefer", "require", "verify-ca", "verify-full", "no-verify"] as const;
const FILE_PARAMETERS = { sslrootcert: "PGSSLROOTCERT", sslcert: "PGSSLCERT", sslkey: "PGSSLKEY" } as const;
const SUPPORTED_PARAMETERS = new Set([
  "sslmode",
  "ssl",
  "uselibpqcompat",
  "application_name",
  ...Object.keys(FILE_PARAMETERS),
]);

/**
 * The libpq SSL mode that matches what node-pg (pg-connection-string 2.x) does for the same URL:
 *
 * - Without `uselibpqcompat`, any `sslmode` other than `disable` and `no-verify`, `ssl=true`
 *   and any certificate parameter make node-pg verify the certificate and the host name.
 * - With `uselibpqcompat=true`, `prefer` still requires TLS without verification, `require`
 *   with a root certificate verifies the certificate but not the host name, and the remaining
 *   cases verify both.
 *
 * Without TLS parameters, node-pg connects without TLS; the libpq default `prefer` is not weaker.
 */
function libpqSslMode(url: URL): string | undefined {
  const mode = url.searchParams.get("sslmode");
  const ssl = url.searchParams.get("ssl");
  if (mode !== null && !(SSL_MODES as readonly string[]).includes(mode)) {
    throw new BackupConfigurationError(`the backup tools do not support sslmode=${mode}`);
  }
  if (ssl !== null && ssl !== "true" && ssl !== "1") {
    throw new BackupConfigurationError(
      `the backup tools do not support ssl=${ssl}; use sslmode=disable instead`,
    );
  }
  const certificates = Object.keys(FILE_PARAMETERS).some((parameter) => !!url.searchParams.get(parameter));
  if (mode === "disable") return "disable";
  if (url.searchParams.get("uselibpqcompat") === "true") {
    if (mode === "prefer") return "require";
    if (mode === "require") return url.searchParams.get("sslrootcert") ? "verify-ca" : "require";
    if (mode === "verify-ca") return "verify-ca";
  } else if (mode === "no-verify") {
    return "require";
  }
  if (mode !== null || ssl !== null || certificates) return "verify-full";
  return undefined;
}

/**
 * Environment for libpq tools such as pg_dump. The password never appears in the process
 * list, and TLS is never weaker than the application's connection for the same URL.
 */
export function libpqEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  for (const name of url.searchParams.keys()) {
    if (!SUPPORTED_PARAMETERS.has(name)) {
      throw new BackupConfigurationError(`the backup tools cannot use the URL parameter ${name}`);
    }
  }
  const env: NodeJS.ProcessEnv = {
    PGHOST: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  const sslmode = libpqSslMode(url);
  if (sslmode) env.PGSSLMODE = sslmode;
  for (const [parameter, variable] of Object.entries(FILE_PARAMETERS)) {
    const value = url.searchParams.get(parameter);
    if (value) env[variable] = value;
  }
  const applicationName = url.searchParams.get("application_name");
  if (applicationName) env.PGAPPNAME = applicationName;
  return env;
}

/** True for errors of a stream whose other end has gone away. */
function isBrokenPipe(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPIPE" || code === "ERR_STREAM_PREMATURE_CLOSE" || code === "ERR_STREAM_DESTROYED";
}

/** Collects the error output of a child process. */
function collect(child: ChildProcess): () => string {
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  return () => stderr;
}

function waitForExit(child: ChildProcess, tool: string, stderr: () => string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${tool} exited with code ${code}: ${stderr().trim().slice(0, 2000)}`));
    });
  });
}

/**
 * Uses pg_dump and pg_restore in the custom format. The tools must be at least as new as the
 * server; the image ships clients for every supported PostgreSQL version and the matching
 * one is chosen by the server's major version.
 */
interface Tools {
  dump: string;
  restore: string;
  psql: string;
}

export class PostgresArchiver implements DatabaseArchiver {
  readonly #databaseUrl: string;
  readonly #binDir: string | undefined;
  #tools: Promise<Tools> | undefined;

  constructor(options: { databaseUrl: string; binDir?: string | undefined }) {
    this.#databaseUrl = options.databaseUrl;
    this.#binDir = options.binDir;
  }

  async #query<T extends pg.QueryResultRow>(text: string): Promise<T[]> {
    const client = new pg.Client({
      connectionString: this.#databaseUrl,
      application_name: "lunedo-backup",
    });
    await client.connect();
    try {
      return (await client.query<T>(text)).rows;
    } finally {
      await client.end();
    }
  }

  async tools(): Promise<Tools> {
    this.#tools ??= (async () => {
      const [row] = await this.#query<{ version: string }>(
        "select current_setting('server_version_num') as version",
      );
      const major = Math.floor(Number(row?.version ?? 0) / 10000);
      const candidates = [this.#binDir, `/usr/lib/postgresql/${major}/bin`].filter(
        (dir): dir is string => !!dir,
      );
      const dir = candidates.find((candidate) => existsSync(path.join(candidate, "pg_dump")));
      return {
        dump: dir ? path.join(dir, "pg_dump") : "pg_dump",
        restore: dir ? path.join(dir, "pg_restore") : "pg_restore",
        psql: dir ? path.join(dir, "psql") : "psql",
      };
    })();
    return this.#tools;
  }

  dump(): Readable {
    const output = new PassThrough();
    this.tools().then(
      ({ dump }) => {
        let stderr = "";
        // Large objects are not used; without them the restore script has no transaction control of its own.
        const child = spawn(dump, ["--format=custom", "--no-owner", "--no-privileges", "-B"], {
          env: { ...process.env, ...libpqEnvironment(this.#databaseUrl) },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.stdout?.pipe(output, { end: false });
        waitForExit(child, "pg_dump", () => stderr).then(
          () => output.end(),
          (error: unknown) => output.destroy(error as Error),
        );
      },
      (error: unknown) => output.destroy(error as Error),
    );
    return output;
  }

  /**
   * pg_restore turns the dump into SQL, which psql runs inside one transaction. The commit is
   * sent only after pg_restore has succeeded; on any failure psql is stopped and PostgreSQL
   * rolls the transaction back.
   */
  async restore(dump: Readable, options: { replaceExisting: boolean }): Promise<void> {
    const tools = await this.tools();
    const env = { ...process.env, ...libpqEnvironment(this.#databaseUrl) };
    const psql = spawn(tools.psql, ["--no-psqlrc", "--quiet", "--set=ON_ERROR_STOP=1"], {
      env,
      stdio: ["pipe", "ignore", "pipe"],
    });
    const restore = spawn(tools.restore, ["--no-owner", "--no-privileges", "--exit-on-error", "--file=-"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const psqlExited = waitForExit(psql, "psql", collect(psql));
    const restoreExited = waitForExit(restore, "pg_restore", collect(restore));
    psqlExited.catch(() => {});
    restoreExited.catch(() => {});
    const script = psql.stdin as Writable;
    // Failures of psql surface through its exit code.
    script.on("error", () => {});
    let inputError: unknown;
    try {
      script.write(`begin;\n${options.replaceExisting ? DROP_SCHEMAS : ""}`);
      await Promise.race([
        Promise.all([
          pipeline(
            dump.on("error", (error) => {
              inputError ??= error;
            }),
            restore.stdin as Writable,
          ),
          pipeline(restore.stdout as Readable, script, { end: false }),
          restoreExited,
        ]),
        psqlExited.then(() => {
          throw new Error("psql exited before the restore was complete");
        }),
      ]);
      script.end("commit;\n");
      await psqlExited;
    } catch (error) {
      restore.kill();
      psql.kill();
      const [restoreResult, psqlResult] = await Promise.allSettled([restoreExited, psqlExited]);
      // A failing psql breaks the pipes of pg_restore, and a failing dump makes pg_restore fail;
      // report the cause, not the consequence.
      if (psql.exitCode && psqlResult.status === "rejected") throw psqlResult.reason;
      if (inputError && !isBrokenPipe(inputError)) throw inputError;
      if (restore.exitCode && restoreResult.status === "rejected") throw restoreResult.reason;
      throw error;
    }
  }

  async isEmpty(): Promise<boolean> {
    const [row] = await this.#query<{ count: string }>(
      `select count(*) as count from pg_tables where schemaname not in (${SYSTEM_SCHEMA_LIST})`,
    );
    return Number(row?.count ?? 0) === 0;
  }
}
