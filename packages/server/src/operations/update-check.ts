import { sql } from "drizzle-orm";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { instanceAdministratorIds } from "../auth/emergency-recipients.js";
import type { InstallMethod } from "../config/definitions.js";
import type { Database } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import type { NotificationService } from "../notifications/service.js";
import { OutboundError, type OutboundPolicy, openOutbound } from "../outbound/guarded-request.js";
import type { SettingsService } from "../settings/service.js";
import {
  newerReleases,
  type Release,
  type RunningChangelog,
  releaseSchema,
  runningChangelog,
  versionFileSchema,
} from "./changelog.js";
import { updateCheckSetting } from "./settings.js";
import { parseReleaseVersion } from "./version.js";

export const IMAGE_REPOSITORY = "ghcr.io/pagehall/pagehall";
export const RELEASES_URL = "https://github.com/pagehall/pagehall/releases";
export const VERSION_FILE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export const updateCheckFailures = [
  "unreachable",
  "timeout",
  "blockedAddress",
  "insecureAddress",
  "untrustedCertificate",
  "tooManyRedirects",
  "httpStatus",
  "tooLarge",
  "invalidFile",
] as const;
export type UpdateCheckFailure = (typeof updateCheckFailures)[number];

export class UpdateCheckError extends Error {
  override name = "UpdateCheckError";

  constructor(
    readonly reason: UpdateCheckFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface UpdateEnvironment {
  check: boolean;
  url: string;
  installMethod: InstallMethod | undefined;
  installDir: string | undefined;
  changelogFile: string;
}

export interface UpdateCommands {
  method: InstallMethod | "unknown";
  steps: { kind: "command" | "note"; text: string }[];
}

export interface UpdateCheckStatus {
  enabled: boolean;
  disabledBy: "environment" | "setting" | null;
  url: string;
  running: string;
  runningIsRelease: boolean;
  checkedAt: Date | null;
  succeeded: boolean;
  failure: UpdateCheckFailure | null;
  latest: string | null;
  available: Release[];
  commands: UpdateCommands | null;
}

function failureOf(error: unknown): UpdateCheckError {
  if (error instanceof UpdateCheckError) return error;
  if (error instanceof OutboundError) {
    switch (error.reason) {
      case "timeout":
        return new UpdateCheckError("timeout", "The version file did not arrive in time");
      case "blockedAddress":
        return new UpdateCheckError(
          "blockedAddress",
          "The address of the version file points to a private network that PAGEHALL_OUTBOUND_ALLOWED_NETWORKS does not allow",
        );
      case "insecureAddress":
        return new UpdateCheckError("insecureAddress", "Public addresses of the version file must use HTTPS");
      case "untrustedCertificate":
        return new UpdateCheckError("untrustedCertificate", "The certificate of the server is not trusted");
      case "tooManyRedirects":
        return new UpdateCheckError("tooManyRedirects", "The server redirected too often");
      default:
        return new UpdateCheckError("unreachable", "The server of the version file could not be reached");
    }
  }
  return new UpdateCheckError("unreachable", "The server of the version file could not be reached");
}

export async function downloadVersionFile(policy: OutboundPolicy, address: string): Promise<Release[]> {
  let url = address;
  try {
    for (let hop = 0; ; hop += 1) {
      const response = await openOutbound(policy, {
        url,
        headers: { accept: "application/json", "user-agent": "Pagehall update check" },
        timeoutMs: TIMEOUT_MS,
      });
      const location = response.headers.location;
      if (REDIRECTS.has(response.status) && location) {
        response.body.resume();
        if (hop >= MAX_REDIRECTS)
          throw new UpdateCheckError("tooManyRedirects", "The server redirected too often");
        url = new URL(location, url).toString();
        continue;
      }
      if (response.status !== 200) {
        response.body.resume();
        throw new UpdateCheckError("httpStatus", `The server answered with status ${response.status}`);
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        const buffer = chunk as Buffer;
        size += buffer.length;
        if (size > VERSION_FILE_MAX_BYTES) {
          response.body.destroy();
          throw new UpdateCheckError("tooLarge", "The version file is larger than 2 MB");
        }
        chunks.push(buffer);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new UpdateCheckError("invalidFile", "The version file is not valid JSON");
      }
      const file = versionFileSchema.safeParse(parsed);
      if (!file.success)
        throw new UpdateCheckError("invalidFile", "The version file does not have the expected form");
      return file.data.releases;
    }
  } catch (error) {
    throw failureOf(error);
  }
}

export function updateCommands(
  method: InstallMethod | undefined,
  directory: string | undefined,
  version: string,
): UpdateCommands {
  const image = `${IMAGE_REPOSITORY}:${version}`;
  const folder = directory ?? "<installation directory>";
  switch (method) {
    case "script":
      return {
        method,
        steps: [
          { kind: "command", text: `cd ${folder}` },
          { kind: "command", text: `./pagehall update ${version}` },
        ],
      };
    case "compose":
      return {
        method,
        steps: [
          { kind: "command", text: `cd ${folder}` },
          {
            kind: "command",
            text: "docker compose exec pagehall pagehall backup create --output /var/lib/pagehall/backups/before-update.phbak",
          },
          { kind: "note", text: `Set the image of the pagehall service to ${image}.` },
          { kind: "command", text: "docker compose pull" },
          { kind: "command", text: "docker compose up -d" },
        ],
      };
    default:
      return {
        method: method ?? "unknown",
        steps: [
          { kind: "note", text: "Create a backup with pagehall backup create before you update." },
          { kind: "command", text: `docker pull ${image}` },
          { kind: "note", text: `Restart every Pagehall container with ${image}.` },
        ],
      };
  }
}

type StateRow = {
  checked_at: Date | string | null;
  succeeded: boolean;
  failure: string | null;
  releases: unknown;
  notified_version: string | null;
};

export class UpdateCheckService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #notifications: NotificationService;
  readonly #policy: OutboundPolicy;
  readonly #logger: Logger;
  readonly #environment: UpdateEnvironment;
  readonly #running: () => string;
  readonly #download: (policy: OutboundPolicy, url: string) => Promise<Release[]>;
  readonly #now: () => Date;

  constructor(options: {
    database: Database;
    settings: SettingsService;
    notifications: NotificationService;
    policy: OutboundPolicy;
    logger: Logger;
    environment: UpdateEnvironment;
    running: () => string;
    download?: (policy: OutboundPolicy, url: string) => Promise<Release[]>;
    now?: () => Date;
  }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#notifications = options.notifications;
    this.#policy = options.policy;
    this.#logger = options.logger;
    this.#environment = options.environment;
    this.#running = options.running;
    this.#download = options.download ?? downloadVersionFile;
    this.#now = options.now ?? (() => new Date());
  }

  async enabled(): Promise<{ enabled: boolean; disabledBy: "environment" | "setting" | null }> {
    if (!this.#environment.check) return { enabled: false, disabledBy: "environment" };
    if (!(await this.#settings.get(updateCheckSetting, {}))) return { enabled: false, disabledBy: "setting" };
    return { enabled: true, disabledBy: null };
  }

  async #state(): Promise<StateRow | undefined> {
    const result = await this.#database.execute<StateRow>(
      sql`select checked_at, succeeded, failure, releases, notified_version from update_check_state where singleton`,
    );
    return result.rows[0];
  }

  async check(): Promise<UpdateCheckStatus> {
    if (!(await this.enabled()).enabled) return this.status();
    const now = this.#now();
    try {
      const releases = await this.#download(this.#policy, this.#environment.url);
      await this.#database.transaction(async (tx) => {
        await tx.execute(sql`
          insert into update_check_state (singleton, checked_at, succeeded, failure, releases)
          values (true, ${now}, true, null, ${JSON.stringify(releases)}::jsonb)
          on conflict (singleton) do update
            set checked_at = excluded.checked_at, succeeded = true, failure = null, releases = excluded.releases
        `);
        await this.#notifyOnce(tx, releases);
      });
    } catch (error) {
      const failure = failureOf(error);
      this.#logger.warn({ reason: failure.reason }, "The update check failed");
      await this.#database.execute(sql`
        insert into update_check_state (singleton, checked_at, succeeded, failure)
        values (true, ${now}, false, ${failure.reason})
        on conflict (singleton) do update set checked_at = excluded.checked_at, succeeded = false, failure = excluded.failure
      `);
    }
    return this.status();
  }

  async #notifyOnce(tx: Parameters<Parameters<Database["transaction"]>[0]>[0], releases: readonly Release[]) {
    const running = this.#running();
    if (!parseReleaseVersion(running)) return;
    const available = newerReleases(releases, running);
    const latest = available.at(-1);
    if (!latest) return;
    const claimed = await tx.execute<{ singleton: boolean }>(sql`
      update update_check_state set notified_version = ${latest.version}
      where singleton and notified_version is distinct from ${latest.version}
      returning singleton
    `);
    if (claimed.rows.length === 0) return;
    const recipients = await instanceAdministratorIds(tx);
    if (recipients.length === 0) return;
    const url = await this.#settings.get(instanceUrlSetting, {}, { executor: tx });
    await this.#notifications.notify(tx, {
      type: "operations.updateAvailable",
      recipients,
      organizationId: null,
      targetId: null,
      params: {
        version: latest.version,
        current: running,
        breaking: available.some(
          (release) => release.notes.breaking.length > 0 || release.notes.manualSteps.length > 0,
        ),
        link: url ? `${url}/settings/instance/updates` : null,
      },
    });
  }

  async status(): Promise<UpdateCheckStatus> {
    const { enabled, disabledBy } = await this.enabled();
    const running = this.#running();
    const state = await this.#state();
    const stored = releaseSchema.array().safeParse(state?.releases ?? []);
    const available = enabled && stored.success ? newerReleases(stored.data, running) : [];
    const latest = available.at(-1)?.version ?? null;
    const failure = state?.failure ?? null;
    return {
      enabled,
      disabledBy,
      url: this.#environment.url,
      running,
      runningIsRelease: parseReleaseVersion(running) !== null,
      checkedAt: enabled && state?.checked_at ? new Date(state.checked_at) : null,
      succeeded: enabled && (state?.succeeded ?? false),
      failure:
        enabled && failure
          ? (updateCheckFailures as readonly string[]).includes(failure)
            ? (failure as UpdateCheckFailure)
            : "unreachable"
          : null,
      latest,
      available,
      commands: latest
        ? updateCommands(this.#environment.installMethod, this.#environment.installDir, latest)
        : null,
    };
  }

  whatsNew(): Promise<RunningChangelog> {
    return runningChangelog(this.#environment.changelogFile, this.#running());
  }

  async checkedSince(since: Date): Promise<boolean> {
    const state = await this.#state();
    return state?.checked_at ? new Date(state.checked_at) >= since : false;
  }

  async updateAvailable(): Promise<boolean | null> {
    const status = await this.status();
    if (!status.enabled) return null;
    return status.runningIsRelease && status.latest !== null;
  }
}
