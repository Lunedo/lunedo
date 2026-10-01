import { randomUUID } from "node:crypto";
import { statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { setupStepSchemas } from "@pagehall/shared";
import { eq } from "drizzle-orm";
import { type AccountService, withUniqueEmail } from "../accounts/accounts.js";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import { ANONYMOUS, accountPrincipal } from "../accounts/principal.js";
import { accounts, instance } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import { PASSWORD_MAX_LENGTH } from "../auth/passwords.js";
import { recoveryCodes, sessions, totpCredentials, webauthnCredentials } from "../auth/schema.js";
import type { RecoveryCodeService, TotpService } from "../auth/two-factor.js";
import { formatKeyEntry, type KeyRing } from "../crypto/key-ring.js";
import type { KeyRingHolder } from "../crypto/key-ring-holder.js";
import type { Database } from "../database/database.js";
import { migrationStatus } from "../database/migrate.js";
import type { DatabasePool } from "../database/pool.js";
import { type MailService } from "../mail/mail-service.js";
import { type OrganizationService } from "../organizations/organizations.js";
import { organizations } from "../organizations/schema.js";
import { organizationSettingsChain } from "../organizations/settings.js";
import { languageSetting, timeZoneSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { defineSetupAction, type SetupActionContext, type SetupStep } from "./framework.js";
import { SetupStepError } from "./setup-service.js";

const CLOCK_TOLERANCE_MS = 5_000;
const LOW_DISK_BYTES = 1024 ** 3;

type CheckStatus = "ok" | "warning" | "error";

export interface SetupStepDependencies {
  organizations: OrganizationService;
  database: Database;
  pool: DatabasePool;
  settings: SettingsService;
  accounts: AccountService;
  totp: TotpService;
  recoveryCodes: RecoveryCodeService;
  mail: MailService;
  audit: AuditLog;
  keyRing: KeyRingHolder;
  backupKeys: KeyRing;
  filesDir: string;
  configuredInstanceUrl?: string | undefined;
}

export function systemCheckStep(deps: SetupStepDependencies): SetupStep {
  return {
    id: "systemCheck",
    order: 10,
    required: true,
    async describe({ request }) {
      const checks: Record<string, { status: CheckStatus } & Record<string, unknown>> = {};

      try {
        const [row] = (
          await deps.pool.query<{ version: string; now: Date }>(
            "select current_setting('server_version') as version, now() as now",
          )
        ).rows;
        const migrations = await migrationStatus(deps.pool);
        checks.database = {
          status: migrations.upToDate ? "ok" : "error",
          version: row?.version ?? null,
          migrationsUpToDate: migrations.upToDate,
        };
        const offsetMs = row ? Math.abs(new Date(row.now).getTime() - Date.now()) : null;
        checks.clock = {
          status: offsetMs !== null && offsetMs <= CLOCK_TOLERANCE_MS ? "ok" : "warning",
          offsetMs,
        };
      } catch {
        checks.database = { status: "error", version: null, migrationsUpToDate: false };
        checks.clock = { status: "warning", offsetMs: null };
      }

      try {
        const probe = path.join(deps.filesDir, `.setup-check-${randomUUID()}`);
        await writeFile(probe, "");
        await unlink(probe);
        const stats = await statfs(deps.filesDir);
        const freeBytes = stats.bavail * stats.bsize;
        checks.fileStorage = {
          status: freeBytes < LOW_DISK_BYTES ? "warning" : "ok",
          writable: true,
          freeBytes,
        };
      } catch {
        checks.fileStorage = { status: "error", writable: false, freeBytes: null };
      }

      const url = await deps.settings.get(instanceUrlSetting, {});
      checks.instanceUrl = { status: url ? "ok" : "warning", configured: url !== "" };
      const https = url.startsWith("https:") && request.protocol === "https";
      checks.https = {
        status: https ? "ok" : "warning",
        instanceUrl: url.startsWith("https:"),
        request: request.protocol === "https",
      };
      return { checks };
    },
    actions: {
      acknowledge: defineSetupAction({
        input: setupStepSchemas.systemCheck.actions.acknowledge.input,
        async run(context) {
          await context.complete();
          return {};
        },
      }),
    },
  };
}

export function instanceStep(deps: SetupStepDependencies): SetupStep {
  return {
    id: "instance",
    order: 20,
    required: true,
    async describe({ request }) {
      return {
        url: await deps.settings.get(instanceUrlSetting, {}),
        name: await deps.settings.get(instanceNameSetting, {}),
        suggestedUrl:
          deps.configuredInstanceUrl ?? (request.host ? `${request.protocol}://${request.host}` : null),
      };
    },
    actions: {
      save: defineSetupAction({
        input: setupStepSchemas.instance.actions.save.input,
        async run(context, input) {
          await deps.settings.set(instanceUrlSetting, {}, "instance", input.url, { tx: context.tx });
          await deps.settings.set(instanceNameSetting, {}, "instance", input.name, { tx: context.tx });
          await context.complete();
          return {};
        },
      }),
    },
  };
}

async function ownerOf(context: SetupActionContext): Promise<{ id: string; email: string } | null> {
  const [row] = await context.tx
    .select({ id: accounts.id, email: accounts.email })
    .from(instance)
    .innerJoin(accounts, eq(accounts.id, instance.ownerAccountId));
  return row?.email ? { id: row.id, email: row.email } : null;
}

export function ownerStep(deps: SetupStepDependencies): SetupStep {
  return {
    id: "owner",
    order: 30,
    required: true,
    async describe() {
      const [row] = await deps.database
        .select({ email: accounts.email, name: accounts.name, totpConfirmedAt: totpCredentials.confirmedAt })
        .from(instance)
        .innerJoin(accounts, eq(accounts.id, instance.ownerAccountId))
        .leftJoin(totpCredentials, eq(totpCredentials.accountId, accounts.id));
      return {
        owner: row ? { email: row.email, name: row.name } : null,
        totpConfirmed: row?.totpConfirmedAt != null,
        passwordMaxLength: PASSWORD_MAX_LENGTH,
      };
    },
    actions: {
      createAccount: defineSetupAction({
        input: setupStepSchemas.owner.actions.createAccount.input,
        async run(context, input) {
          const existing = await ownerOf(context);
          let accountId: string;
          if (existing) {
            const passwordHash = await deps.accounts.hashPassword(input.password, existing.id);
            await withUniqueEmail(() =>
              context.tx
                .update(accounts)
                .set({ email: input.email, name: input.name, passwordHash, passwordChangedAt: new Date() })
                .where(eq(accounts.id, existing.id)),
            );
            for (const table of [totpCredentials, webauthnCredentials, recoveryCodes, sessions]) {
              await context.tx.delete(table).where(eq(table.accountId, existing.id));
            }
            accountId = existing.id;
          } else {
            const account = await deps.accounts.createStandard(context.tx, {
              email: input.email,
              name: input.name,
              password: input.password,
              homeOrganizationId: null,
            });
            await context.tx.insert(instance).values({ id: 1 }).onConflictDoNothing();
            await context.tx.update(instance).set({ ownerAccountId: account.id }).where(eq(instance.id, 1));
            accountId = account.id;
          }
          if (input.language) {
            await deps.settings.set(languageSetting, { user: accountId }, "user", input.language, {
              tx: context.tx,
            });
          }
          await context.reopen();
          return {};
        },
      }),
      beginTotp: defineSetupAction({
        input: setupStepSchemas.owner.actions.beginTotp.input,
        async run(context) {
          const owner = await ownerOf(context);
          if (!owner) throw new SetupStepError("ownerMissing", "Create the owner account first");
          const issuer = await deps.settings.get(instanceNameSetting, {});
          await context.tx.delete(totpCredentials).where(eq(totpCredentials.accountId, owner.id));
          const setup = await deps.totp.begin(owner.id, { issuer, account: owner.email }, context.tx);
          if (!setup) throw new SetupStepError("totpExists", "TOTP is already set up");
          return { body: setup };
        },
      }),
      confirmTotp: defineSetupAction({
        input: setupStepSchemas.owner.actions.confirmTotp.input,
        async run(context, input) {
          const owner = await ownerOf(context);
          if (!owner) throw new SetupStepError("ownerMissing", "Create the owner account first");
          if (!(await deps.totp.verify(context.tx, owner.id, input.code, { confirming: true }))) {
            throw new SetupStepError("invalidSecondFactor", "The code is not valid");
          }
          const codes = await deps.recoveryCodes.generate(context.tx, owner.id);
          await deps.audit.record(context.tx, {
            name: "twoFactor.totpAdded",
            actor: accountPrincipal(owner.id),
            targetId: owner.id,
            fields: {},
          });
          await deps.audit.record(context.tx, {
            name: "twoFactor.recoveryCodesGenerated",
            actor: accountPrincipal(owner.id),
            targetId: owner.id,
            fields: { count: codes.length },
          });
          await context.complete();
          return { body: { recoveryCodes: codes } };
        },
      }),
    },
  };
}

function keyRingLine(ring: KeyRing): string {
  return ring.versions.map((version) => formatKeyEntry(version, ring.get(version).use())).join(",");
}

export function keyBackupStep(deps: SetupStepDependencies): SetupStep {
  return {
    id: "keyBackup",
    order: 40,
    required: true,
    async describe({ state }) {
      return { downloaded: typeof state.downloadedAt === "string", provider: deps.keyRing.provider.name };
    },
    actions: {
      download: defineSetupAction({
        input: setupStepSchemas.keyBackup.actions.download.input,
        async run(context) {
          if (typeof context.state.downloadedAt === "string") {
            throw new SetupStepError("keysAlreadyDownloaded", "The keys can be downloaded once only");
          }
          const master = deps.keyRing.ring;
          await context.setState({ downloadedAt: new Date().toISOString() });
          await deps.audit.record(context.tx, {
            name: "setup.keyBackupDownloaded",
            actor: ANONYMOUS,
            targetId: null,
            fields: { masterKeyVersions: master.versions, backupKeyVersions: deps.backupKeys.versions },
          });
          const content = [
            "# Pagehall keys. Store this file outside the server, for example in a password manager.",
            "# Without these keys, encrypted data and backups cannot be restored.",
            `PAGEHALL_MASTER_KEYS=${keyRingLine(master)}`,
            `PAGEHALL_BACKUP_KEY=${keyRingLine(deps.backupKeys)}`,
            "",
          ].join("\n");
          return {
            download: { filename: "pagehall-keys.env", contentType: "text/plain; charset=utf-8", content },
          };
        },
      }),
      confirm: defineSetupAction({
        input: setupStepSchemas.keyBackup.actions.confirm.input,
        async run(context) {
          if (typeof context.state.downloadedAt !== "string") {
            throw new SetupStepError("keysNotDownloaded", "Download the keys first");
          }
          await context.complete();
          return {};
        },
      }),
    },
  };
}

export function mailStep(deps: SetupStepDependencies): SetupStep {
  return {
    id: "mail",
    order: 60,
    required: false,
    async describe() {
      return { smtp: await deps.mail.smtpConfiguration(), passwordSet: await deps.mail.hasSmtpPassword() };
    },
    actions: {
      save: defineSetupAction({
        input: setupStepSchemas.mail.actions.save.input,
        async run(context, input) {
          const { password, ...configuration } = input;
          await deps.mail.configureSmtp(configuration, password, { tx: context.tx });
          await context.complete();
          return {};
        },
      }),
      test: defineSetupAction({
        input: setupStepSchemas.mail.actions.test.input,
        async run(_context, input) {
          const { to, language, password, ...configuration } = input;
          const result = await deps.mail.sendTest(to, language, {
            configuration,
            password,
          });
          return { body: result };
        },
      }),
    },
  };
}

export function organizationStep(deps: SetupStepDependencies): SetupStep {
  return {
    id: "organization",
    order: 50,
    required: true,
    async describe({ state }) {
      const id = typeof state.organizationId === "string" ? state.organizationId : null;
      return { organization: id ? await deps.organizations.get(id) : null };
    },
    actions: {
      save: defineSetupAction({
        input: setupStepSchemas.organization.actions.save.input,
        async run(context, input) {
          const existing =
            typeof context.state.organizationId === "string" ? context.state.organizationId : null;
          if (existing) {
            const chain = organizationSettingsChain(existing);
            await context.tx
              .update(organizations)
              .set({ name: input.name, ...(input.slug ? { slug: input.slug } : {}), updatedAt: new Date() })
              .where(eq(organizations.id, existing));
            await deps.settings.set(languageSetting, chain, "organization", input.language, {
              tx: context.tx,
            });
            await deps.settings.set(timeZoneSetting, chain, "organization", input.timeZone, {
              tx: context.tx,
            });
            await context.complete();
            return { body: { organizationId: existing } };
          }
          const owner = await ownerOf(context);
          if (!owner) throw new SetupStepError("ownerMissing", "Create the owner account first");
          const organization = await deps.organizations.create(context.tx, ANONYMOUS, {
            name: input.name,
            ...(input.slug ? { slug: input.slug } : {}),
            language: input.language,
            timeZone: input.timeZone,
            ownerAccountId: owner.id,
          });
          await context.setState({ organizationId: organization.id });
          await context.complete();
          return { body: { organizationId: organization.id } };
        },
      }),
    },
  };
}

export function builtinSetupSteps(deps: SetupStepDependencies): SetupStep[] {
  return [
    systemCheckStep(deps),
    instanceStep(deps),
    ownerStep(deps),
    keyBackupStep(deps),
    organizationStep(deps),
    mailStep(deps),
  ];
}
