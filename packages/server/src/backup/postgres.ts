import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";

/** Access to the database part of a backup. */
export interface DatabaseArchiver {
  /** Streams a dump of the whole database. */
  dump(): Readable;
  /** Loads a dump produced by `dump` into the database. */
  restore(dump: Readable): Promise<void>;
  /** True when the database contains no tables outside the system schemas. */
  isEmpty(): Promise<boolean>;
  /** Drops all application schemas, for a forced restore. */
  clear(): Promise<void>;
}

const SYSTEM_SCHEMAS = ["pg_catalog", "information_schema", "pg_toast"];

/** Environment for libpq tools, so that the password never appears in the process list. */
export function libpqEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  const env: NodeJS.ProcessEnv = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
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
export class PostgresArchiver implements DatabaseArchiver {
  readonly #databaseUrl: string;
  readonly #binDir: string | undefined;
  #tools: Promise<{ dump: string; restore: string }> | undefined;

  constructor(options: { databaseUrl: string; binDir?: string | undefined }) {
    this.#databaseUrl = options.databaseUrl;
    this.#binDir = options.binDir;
  }

  async #query<T extends pg.QueryResultRow>(text: string): Promise<T[]> {
    const client = new pg.Client({
      connectionString: this.#databaseUrl,
      application_name: "pagehall-backup",
    });
    await client.connect();
    try {
      return (await client.query<T>(text)).rows;
    } finally {
      await client.end();
    }
  }

  async tools(): Promise<{ dump: string; restore: string }> {
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
      };
    })();
    return this.#tools;
  }

  dump(): Readable {
    const output = new PassThrough();
    this.tools().then(
      ({ dump }) => {
        let stderr = "";
        const child = spawn(dump, ["--format=custom", "--no-owner", "--no-privileges"], {
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

  async restore(dump: Readable): Promise<void> {
    const { restore } = await this.tools();
    const env = libpqEnvironment(this.#databaseUrl);
    let stderr = "";
    const child = spawn(
      restore,
      [
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        "--single-transaction",
        `--dbname=${env.PGDATABASE ?? ""}`,
      ],
      {
        env: { ...process.env, ...env },
        stdio: ["pipe", "ignore", "pipe"],
      },
    );
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const exited = waitForExit(child, "pg_restore", () => stderr);
    await Promise.all([pipeline(dump, child.stdin as NodeJS.WritableStream), exited]);
  }

  async isEmpty(): Promise<boolean> {
    const [row] = await this.#query<{ count: string }>(
      `select count(*) as count from pg_tables where schemaname not in (${SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(", ")})`,
    );
    return Number(row?.count ?? 0) === 0;
  }

  async clear(): Promise<void> {
    const schemas = await this.#query<{ name: string }>(
      `select nspname as name from pg_namespace
       where nspname not in (${SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(", ")}) and nspname not like 'pg_%'`,
    );
    const client = new pg.Client({
      connectionString: this.#databaseUrl,
      application_name: "pagehall-backup",
    });
    await client.connect();
    try {
      for (const { name } of schemas) await client.query(`drop schema "${name.replace(/"/g, '""')}" cascade`);
      await client.query("create schema public");
    } finally {
      await client.end();
    }
  }
}
