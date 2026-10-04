import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccountAdministrationService } from "../accounts/administration.js";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database } from "../database/database.js";
import { FIRST_PAGE, type Page, type PageRequest, pageLimit, toPage } from "../database/keyset.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { MembershipService } from "../organizations/memberships.js";
import { OrganizationError } from "../organizations/organizations.js";
import { defineSetting } from "../settings/definition.js";
import type { SettingsService } from "../settings/service.js";
import type { IdentityProviderAdapter, ProviderDefinition, SynchronizedAccount } from "./adapter.js";
import { emptyReport, type GroupMappingService, type SyncReport } from "./groups.js";
import type { IdentityProviderService } from "./providers.js";
import {
  identities,
  identityProviders,
  mappingRules,
  providerDeactivations,
  providerGroups,
  providerSyncRuns,
} from "./schema.js";

export const syncLogRetentionDaysSetting = defineSetting({
  key: "identityProviders.syncLogRetentionDays",
  schema: z.number().int().min(7).max(3650),
  default: 90,
  levels: ["instance"],
  lockable: false,
});

export const providerSyncJob = defineJob({
  name: "identity-providers.synchronize",
  payload: z.object({
    providerId: z.uuid(),
    trigger: z.enum(["schedule", "manual", "reconciliation"]),
    actorId: z.uuid().nullable(),
  }),
  retryLimit: 0,
  expireInSeconds: 60 * 60,
});

export const providerSyncScheduleJob = defineJob({
  name: "identity-providers.schedule-synchronization",
  payload: z.object({}),
  retryLimit: 1,
});

export const providerSyncRetentionJob = defineJob({
  name: "identity-providers.remove-old-sync-runs",
  payload: z.object({}),
  retryLimit: 2,
});

export const PROVIDER_SYNC_SCHEDULE = "*/5 * * * *";
export const PROVIDER_SYNC_RETENTION_SCHEDULE = "23 3 * * *";

const SILENT_RUN_MINUTES = 5;

export type SyncTrigger = "schedule" | "manual" | "scim" | "reconciliation";

export const SCIM_RECONCILIATION_MINUTES = 24 * 60;
export type SyncStatus = "running" | "succeeded" | "warnings" | "failed" | "cancelled";

export interface SyncRunSummary {
  id: string;
  providerId: string;
  trigger: SyncTrigger;
  status: SyncStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  changeCount: number;
  warningCount: number;
  error: string | null;
}

export interface SyncRunDetails extends SyncRunSummary, Omit<SyncReport, "mailIds"> {
  references: Record<string, string>;
}

export type SyncRunFilter = "all" | "changes" | "failed";

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown }).cause ?? error;
  return (cause as { code?: string }).code === "23505";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function domainOf(email: string | null): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  return email && at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

export class ProviderSyncService {
  readonly #database: Database;
  readonly #providers: IdentityProviderService;
  readonly #adapters: Map<string, IdentityProviderAdapter>;
  readonly #mapping: GroupMappingService;
  readonly #memberships: MembershipService;
  readonly #administration: AccountAdministrationService;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #jobs: JobQueue | undefined;

  constructor(options: {
    database: Database;
    providers: IdentityProviderService;
    adapters: IdentityProviderAdapter[];
    mapping: GroupMappingService;
    memberships: MembershipService;
    administration: AccountAdministrationService;
    audit: AuditLog;
    settings: SettingsService;
    jobs: JobQueue | undefined;
  }) {
    this.#database = options.database;
    this.#providers = options.providers;
    this.#adapters = new Map(options.adapters.map((adapter) => [adapter.type, adapter]));
    this.#mapping = options.mapping;
    this.#memberships = options.memberships;
    this.#administration = options.administration;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#jobs = options.jobs;
  }

  #adapterFor(provider: ProviderDefinition): IdentityProviderAdapter | null {
    const adapter = this.#adapters.get(provider.type);
    return adapter?.hasDirectory?.(provider) && adapter.synchronizeAccounts ? adapter : null;
  }

  async request(actor: Principal, providerId: string): Promise<{ runId: string | null }> {
    await this.#providers.get(providerId);
    const loaded = await this.#providers.definition(providerId);
    if (loaded && !loaded.active) {
      throw new OrganizationError("providerDeactivated", "The identity provider is deactivated");
    }
    if (!loaded || !this.#adapterFor(loaded.provider)) {
      throw new OrganizationError(
        "syncUnavailable",
        "The provider has no directory to synchronize with; its accounts update at sign-in",
      );
    }
    const actorId = actor.type === "account" ? actor.id : null;
    if (this.#jobs) {
      await this.#jobs.enqueue(providerSyncJob, { providerId, trigger: "manual", actorId });
      return { runId: null };
    }
    const run = await this.run(providerId, "manual", actor);
    return { runId: run?.id ?? null };
  }

  async scheduleDue(): Promise<number> {
    if (!this.#jobs) return 0;
    const providers = await this.#database
      .select({
        id: identityProviders.id,
        config: identityProviders.config,
        lastStart: sql<Date | null>`(select max(r.started_at) from provider_sync_runs r
          where r.provider_id = ${identityProviders}.id and r.trigger in ('schedule', 'reconciliation'))`,
        scim: sql<boolean>`exists (select 1 from scim_tokens t where t.provider_id = ${identityProviders}.id
          and (t.expires_at is null or t.expires_at > now()))`,
      })
      .from(identityProviders);
    let queued = 0;
    for (const row of providers) {
      const loaded = await this.#providers.definition(row.id);
      if (!loaded?.active || !this.#adapterFor(loaded.provider)) continue;
      const minutes = row.scim ? SCIM_RECONCILIATION_MINUTES : loaded.provider.config.sync.intervalMinutes;
      const interval = minutes * 60 * 1000;
      const last = row.lastStart ? new Date(row.lastStart).getTime() : 0;
      if (Date.now() - last < interval) continue;
      const slot = Math.floor(Date.now() / interval);
      await this.#jobs.enqueue(
        providerSyncJob,
        { providerId: row.id, trigger: row.scim ? "reconciliation" : "schedule", actorId: null },
        { idempotencyKey: `${row.id}:${row.scim ? "reconciliation" : "schedule"}:${slot}` },
      );
      queued++;
    }
    return queued;
  }

  async cancel(actor: Principal, providerId: string, runId: string): Promise<boolean> {
    await this.#providers.get(providerId);
    return this.#database.transaction(async (tx) => {
      const [run] = await tx
        .update(providerSyncRuns)
        .set({ cancelRequestedAt: sql`now()` })
        .where(
          and(
            eq(providerSyncRuns.id, runId),
            eq(providerSyncRuns.providerId, providerId),
            eq(providerSyncRuns.status, "running"),
            isNull(providerSyncRuns.cancelRequestedAt),
          ),
        )
        .returning({ id: providerSyncRuns.id });
      if (!run) return false;
      await this.#audit.record(tx, {
        name: "identityProvider.syncCancelled",
        actor,
        targetId: providerId,
        fields: { runId },
      });
      return true;
    });
  }

  async #beat(runId: string): Promise<boolean> {
    const [row] = await this.#database
      .update(providerSyncRuns)
      .set({ heartbeatAt: sql`now()` })
      .where(eq(providerSyncRuns.id, runId))
      .returning({ cancelRequestedAt: providerSyncRuns.cancelRequestedAt });
    return row?.cancelRequestedAt != null;
  }

  async run(
    providerId: string,
    trigger: SyncTrigger,
    actor: Principal = SYSTEM,
    signal?: AbortSignal,
  ): Promise<SyncRunSummary | null> {
    await this.#database
      .update(providerSyncRuns)
      .set({ status: "failed", finishedAt: new Date(), error: "The run stopped without a sign of life" })
      .where(
        and(
          eq(providerSyncRuns.providerId, providerId),
          eq(providerSyncRuns.status, "running"),
          lt(providerSyncRuns.heartbeatAt, sql`now() - make_interval(mins => ${SILENT_RUN_MINUTES})`),
        ),
      );
    let runId: string;
    try {
      const [created] = await this.#database
        .insert(providerSyncRuns)
        .values({ providerId, trigger })
        .returning({ id: providerSyncRuns.id });
      if (!created) return null;
      runId = created.id;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
    const started = Date.now();
    const report = emptyReport();
    let failure: string | null = null;
    let cancelled = false;
    const stopRequested = async (): Promise<boolean> => signal?.aborted === true || this.#beat(runId);
    try {
      const loaded = await this.#providers.definition(providerId);
      if (!loaded) throw new Error("The identity provider does not exist");
      if (!loaded.active) throw new Error("The identity provider is deactivated");
      const provider = loaded.provider;
      const adapter = this.#adapterFor(provider);
      if (!adapter?.synchronizeAccounts) throw new Error("The provider has no directory to synchronize with");
      const linked = await this.#database
        .select({ id: identities.id, accountId: identities.accountId, subject: identities.subject })
        .from(identities)
        .where(eq(identities.providerId, providerId));
      const bySubject = new Map(linked.map((identity) => [identity.subject, identity]));
      for await (const result of adapter.synchronizeAccounts(
        provider,
        loaded.credentials,
        linked.map((identity) => identity.subject),
      )) {
        if (await stopRequested()) {
          cancelled = true;
          break;
        }
        const identity = bySubject.get(result.subject);
        if (!identity) continue;
        try {
          await this.#apply(provider, identity, result, report);
        } catch (error) {
          report.warnings.push({
            kind: "accountFailed",
            accountId: identity.accountId,
            ruleId: null,
            detail: message(error),
          });
          const mailIds = await this.#database.transaction((tx) =>
            this.#mapping.groupReadFailed(tx, identity.id, identity.accountId),
          );
          await this.#mapping.dispatch(mailIds);
        }
      }
      if (!cancelled) await this.#refreshMappedGroups(provider, adapter, loaded.credentials, report);
    } catch (error) {
      failure = message(error);
    }
    const status: SyncStatus = cancelled
      ? "cancelled"
      : failure
        ? "failed"
        : report.warnings.length > 0
          ? "warnings"
          : "succeeded";
    const durationMs = Date.now() - started;
    await this.#database.transaction(async (tx) => {
      await tx
        .update(providerSyncRuns)
        .set({
          status,
          finishedAt: new Date(),
          changes: report.changes,
          warnings: report.warnings,
          error: failure,
        })
        .where(eq(providerSyncRuns.id, runId));
      await this.#audit.record(tx, {
        name: "identityProvider.synchronized",
        actor,
        targetId: providerId,
        fields: {
          runId,
          trigger,
          status,
          changes: report.changes.length,
          warnings: report.warnings.length,
          durationMs,
        },
      });
    });
    await this.#mapping.dispatch(report.mailIds);
    const [summary] = await this.#summaries(eq(providerSyncRuns.id, runId));
    return summary ?? null;
  }

  async #apply(
    provider: ProviderDefinition,
    identity: { id: string; accountId: string },
    result: SynchronizedAccount,
    report: SyncReport,
  ): Promise<void> {
    if (result.state === "unknown") {
      const groups = result.groups;
      if (!groups) return;
      await this.#database.transaction(async (tx) => {
        await this.#mapping.recordGroups(tx, provider.id, identity.id, groups, report);
        await this.#mapping.reconcile(tx, identity.accountId, report);
      });
      return;
    }
    if (result.state !== "enabled") {
      await this.#deactivate(provider, identity.accountId, result.state, report);
      return;
    }
    await this.#reactivate(provider, identity.accountId, report);
    const profile = result.profile;
    if (!profile) return;
    await this.#database.transaction(async (tx) => {
      const domain = domainOf(profile.email);
      const [current] = await tx
        .select({
          email: identities.email,
          signInName: identities.signInName,
          displayName: identities.displayName,
        })
        .from(identities)
        .where(eq(identities.id, identity.id))
        .for("update");
      if (
        current &&
        (current.email !== profile.email ||
          current.signInName !== profile.signInName ||
          current.displayName !== profile.displayName)
      ) {
        await tx
          .update(identities)
          .set({
            email: profile.email,
            emailVerified: domain !== null && provider.config.domains.includes(domain),
            signInName: profile.signInName,
            displayName: profile.displayName,
            updatedAt: new Date(),
          })
          .where(eq(identities.id, identity.id));
        report.changes.push({
          kind: "profileUpdated",
          accountId: identity.accountId,
          organizationId: null,
          detail: null,
        });
      }
      if (profile.groups)
        await this.#mapping.recordGroups(tx, provider.id, identity.id, profile.groups, report);
      await this.#mapping.reconcile(tx, identity.accountId, report);
    });
  }

  async #deactivate(
    provider: ProviderDefinition,
    accountId: string,
    state: "disabled" | "deleted",
    report: SyncReport,
  ): Promise<void> {
    const [account] = await this.#database
      .select({ state: accounts.state })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (account?.state !== "active") return;
    try {
      await this.#memberships.deactivate(SYSTEM, accountId, {
        byProvider: { providerId: provider.id, state },
      });
    } catch (error) {
      report.warnings.push({ kind: "deactivationRefused", accountId, ruleId: null, detail: message(error) });
      return;
    }
    report.changes.push({ kind: "accountDeactivated", accountId, organizationId: null, detail: state });
  }

  async #reactivate(provider: ProviderDefinition, accountId: string, report: SyncReport): Promise<void> {
    const [row] = await this.#database
      .select({ state: accounts.state, providerId: providerDeactivations.providerId })
      .from(accounts)
      .leftJoin(providerDeactivations, eq(providerDeactivations.accountId, accounts.id))
      .where(eq(accounts.id, accountId));
    if (row?.state !== "deactivated" || row.providerId !== provider.id) return;
    if (!(await this.#administration.reactivate(SYSTEM, accountId, { byProvider: provider.id }))) return;
    report.changes.push({ kind: "accountReactivated", accountId, organizationId: null, detail: null });
  }

  async #refreshMappedGroups(
    provider: ProviderDefinition,
    adapter: IdentityProviderAdapter,
    credentials: Parameters<NonNullable<IdentityProviderAdapter["readGroup"]>>[1],
    report: SyncReport,
  ): Promise<void> {
    if (!adapter.readGroup) return;
    const mapped = await this.#database
      .selectDistinct({
        id: providerGroups.id,
        externalId: providerGroups.externalId,
        name: providerGroups.name,
        missingSince: providerGroups.missingSince,
      })
      .from(mappingRules)
      .innerJoin(providerGroups, eq(providerGroups.id, mappingRules.groupId))
      .where(eq(mappingRules.providerId, provider.id));
    for (const group of mapped) {
      const found = await adapter.readGroup(provider, credentials, group.externalId);
      const changed = await this.#database.transaction(async (tx) => {
        if (!found) {
          const rules = await tx
            .select({ id: mappingRules.id })
            .from(mappingRules)
            .where(eq(mappingRules.groupId, group.id));
          for (const rule of rules) {
            report.warnings.push({
              kind: "missingGroup",
              accountId: null,
              ruleId: rule.id,
              detail: group.name ?? group.externalId,
            });
          }
          if (group.missingSince) return false;
          await tx
            .update(providerGroups)
            .set({ missingSince: new Date(), updatedAt: new Date() })
            .where(eq(providerGroups.id, group.id));
          return true;
        }
        const renamed = found.name !== null && found.name !== group.name;
        if (!renamed && !group.missingSince) return false;
        if (renamed) {
          report.changes.push({
            kind: "groupRenamed",
            accountId: null,
            organizationId: null,
            detail: `${group.name ?? group.externalId} → ${found.name}`,
          });
        }
        await tx
          .update(providerGroups)
          .set({ ...(renamed ? { name: found.name } : {}), missingSince: null, updatedAt: new Date() })
          .where(eq(providerGroups.id, group.id));
        if (renamed && found.name) await this.#mapping.renameManagedGroups(tx, group.id, found.name, report);
        return group.missingSince !== null;
      });
      if (!changed) continue;
      await this.#database.transaction(async (tx) => {
        for (const accountId of await this.#mapping.accountsHolding(tx, group.id)) {
          await this.#mapping.reconcile(tx, accountId, report);
        }
      });
    }
  }

  async #summaries(condition: ReturnType<typeof eq>): Promise<SyncRunSummary[]> {
    const rows = await this.#database
      .select()
      .from(providerSyncRuns)
      .where(condition)
      .orderBy(desc(providerSyncRuns.startedAt), desc(providerSyncRuns.id))
      .limit(1);
    return rows.map((row) => this.#summary(row));
  }

  #summary(row: typeof providerSyncRuns.$inferSelect): SyncRunSummary {
    return {
      id: row.id,
      providerId: row.providerId,
      trigger: row.trigger,
      status: row.status,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : null,
      changeCount: Array.isArray(row.changes) ? row.changes.length : 0,
      warningCount: Array.isArray(row.warnings) ? row.warnings.length : 0,
      error: row.error,
    };
  }

  async runs(
    providerId: string,
    filter: SyncRunFilter = "all",
    page: PageRequest = FIRST_PAGE,
  ): Promise<Page<SyncRunSummary>> {
    await this.#providers.get(providerId);
    const conditions = [eq(providerSyncRuns.providerId, providerId)];
    if (filter === "failed") conditions.push(eq(providerSyncRuns.status, "failed"));
    if (filter === "changes") conditions.push(sql`jsonb_array_length(${providerSyncRuns.changes}) > 0`);
    const rows = await this.#database
      .select()
      .from(providerSyncRuns)
      .where(
        and(
          ...conditions,
          page.after
            ? sql`(${providerSyncRuns.startedAt}, ${providerSyncRuns.id}) < (${page.after[0]}::timestamptz, ${page.after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(providerSyncRuns.startedAt), desc(providerSyncRuns.id))
      .limit(pageLimit(page));
    return toPage(
      rows,
      page,
      (row) => [row.startedAt.toISOString(), row.id],
      (row) => this.#summary(row),
    );
  }

  async runDetails(providerId: string, runId: string): Promise<SyncRunDetails | null> {
    await this.#providers.get(providerId);
    const [row] = await this.#database
      .select()
      .from(providerSyncRuns)
      .where(and(eq(providerSyncRuns.id, runId), eq(providerSyncRuns.providerId, providerId)));
    if (!row) return null;
    const changes = (row.changes ?? []) as SyncReport["changes"];
    const warnings = (row.warnings ?? []) as SyncReport["warnings"];
    const accountIds = [
      ...new Set([...changes, ...warnings].flatMap((entry) => (entry.accountId ? [entry.accountId] : []))),
    ];
    const names =
      accountIds.length === 0
        ? []
        : await this.#database
            .select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(inArray(accounts.id, accountIds));
    return {
      ...this.#summary(row),
      changes,
      warnings,
      references: Object.fromEntries(names.map((entry) => [entry.id, entry.name])),
    };
  }

  async lastRun(providerId: string): Promise<SyncRunSummary | null> {
    const [summary] = await this.#summaries(
      and(eq(providerSyncRuns.providerId, providerId), isNotNull(providerSyncRuns.finishedAt)) as ReturnType<
        typeof eq
      >,
    );
    return summary ?? null;
  }

  async applyRetention(): Promise<number> {
    const days = await this.#settings.get(syncLogRetentionDaysSetting, {});
    const removed = await this.#database
      .delete(providerSyncRuns)
      .where(
        and(
          sql`${providerSyncRuns.status} <> 'running'`,
          lt(providerSyncRuns.startedAt, sql`now() - make_interval(days => ${days})`),
        ),
      )
      .returning({ id: providerSyncRuns.id });
    return removed.length;
  }
}
