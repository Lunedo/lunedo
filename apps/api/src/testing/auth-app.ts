import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createServerRuntime, type Env, type ServerRuntime } from "@pagehall/server";
import {
  CapturingTransport,
  createMigratedDatabase,
  deliverPendingMail,
  type TemporaryDatabase,
  testDatabaseBaseUrl,
} from "@pagehall/server/testing";
import type { LightMyRequestResponse } from "fastify";
import { apiContextOf } from "../context.js";
import { CSRF_HEADER } from "../http/csrf.js";
import { createTestApp } from "./create-test-app.js";
import { openApiValidator } from "./openapi-validator.js";

export const TEST_ORIGIN = "https://pagehall.test";

export const databaseBaseUrl = testDatabaseBaseUrl();

export interface AuthTestApp {
  app: NestFastifyApplication;
  runtime: ServerRuntime;
  env: Env;
  mail: CapturingTransport;
  deliverMail(): Promise<void>;
  close(): Promise<void>;
}

export async function createAuthTestApp(
  env: Env = {},
  options: { captureMail?: boolean; webRoot?: string } = {},
): Promise<AuthTestApp> {
  if (!databaseBaseUrl) throw new Error("PAGEHALL_TEST_DATABASE_URL is not set");
  const database: TemporaryDatabase = await createMigratedDatabase(databaseBaseUrl, "pagehall_api_test");
  const dataDir = mkdtempSync(path.join(tmpdir(), "pagehall-api-"));
  const mail = new CapturingTransport();
  const runtimeEnv: Env = {
    PAGEHALL_DATABASE_URL: database.url,
    PAGEHALL_SECRETS_DIR: path.join(dataDir, "secrets"),
    PAGEHALL_FILES_DIR: dataDir,
    PAGEHALL_LOG_LEVEL: "silent",
    PAGEHALL_DATABASE_POOL_SIZE: "4",
    ...env,
  };
  let runtime: ServerRuntime | undefined;
  try {
    runtime = await createServerRuntime({
      role: "api",
      env: runtimeEnv,
      ...(options.captureMail === false ? {} : { mailTransport: () => mail }),
    });
    const started = runtime;
    const app = await createTestApp({
      ...apiContextOf(started),
      ...(options.webRoot ? { webRoot: options.webRoot } : {}),
    });
    return {
      app,
      runtime: started,
      env: runtimeEnv,
      mail,
      deliverMail: () => deliverPendingMail(started.services, started.database),
      async close() {
        await app.close();
        await started.close();
        await database.drop();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await runtime?.close();
    await database.drop();
    throw error;
  }
}

export class TestClient {
  readonly cookies = new Map<string, string>();

  constructor(
    private readonly app: NestFastifyApplication,
    private readonly options: { origin?: string; userAgent?: string; remoteAddress?: string } = {},
  ) {}

  async request(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    const response = await this.app.inject({
      method,
      url,
      remoteAddress: this.options.remoteAddress ?? "198.51.100.10",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(method !== "GET" ? { [CSRF_HEADER]: "1", origin: this.options.origin ?? TEST_ORIGIN } : {}),
        "user-agent":
          this.options.userAgent ??
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        ...headers,
      },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    const mismatches = openApiValidator().check(method, url, response);
    if (mismatches.length > 0) {
      throw new Error(["The response does not match the API description:", ...mismatches].join("\n"));
    }
    const setCookie = response.headers["set-cookie"];
    for (const entry of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair = ""] = entry.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === "" || /Max-Age=0/.test(entry)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  get(url: string, headers?: Record<string, string>) {
    return this.request("GET", url, undefined, headers);
  }

  post(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("POST", url, body ?? {}, headers);
  }

  put(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("PUT", url, body ?? {}, headers);
  }

  patch(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request("PATCH", url, body ?? {}, headers);
  }

  delete(url: string, headers?: Record<string, string>) {
    return this.request("DELETE", url, undefined, headers);
  }
}
