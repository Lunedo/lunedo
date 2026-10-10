import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database } from "../database/database.js";
import type { DatabasePool } from "../database/pool.js";
import type { JobContext, JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { NotificationService } from "../notifications/service.js";
import { isValidSpaceKey, normalizeSpaceKey, spaceKeyCandidates, suggestSpaceKey } from "../spaces/keys.js";
import type { AtlassianDirectory } from "./atlassian.js";
import { deleteCredentials, directoryFor } from "./credentials.js";
import {
  ImportError,
  ImportFormatError,
  ImportHeldError,
  ImportStoppedError,
  ImportYieldError,
} from "./errors.js";
import type { ImportFolder } from "./folder.js";
import type { ByteSource } from "./formats/bytes.js";
import { FILE_RETENTION_DAYS } from "./imports.js";
import { importWorkJob } from "./jobs.js";
import { type ImportPipeline, type PipelinePhase, pipelinePhases } from "./pipeline.js";
import { purgeQuarantineSpace } from "./quarantine.js";
import { type ProblemCode, problemCodes, recordProblems } from "./report.js";
import type { ImportState } from "./schema.js";
import { signalImportChange } from "./signals.js";
import type { ImportReaderRegistry, ImportSource } from "./source.js";
import { StagingStore } from "./staging.js";
import type { UploadService } from "./uploads.js";

const SEGMENT_MS = 25 * 60 * 1000;
const BEAT_MS = 2000;
const PERMISSION_CHECK_MS = 60 * 1000;
const PROGRESS_MS = 1000;
const STALE_MINUTES = 3;
const PHASES_DONE = "done";

interface WorkRow {
  id: string;
  organization_id: string;
  importer_id: string;
  source: string;
  state: ImportState;
  phase: string | null;
  file_kind: "upload" | "folder" | null;
  upload_id: string | null;
  folder_file: string | null;
  organization_slug: string;
  space_name: string | null;
  space_key: string | null;
  source_url: string | null;
  history: boolean;
  people_source: string | null;
  checkpoint: Record<string, unknown>;
  found: Record<string, unknown> | null;
  quarantine_space_id: string | null;
  [key: string]: unknown;
}

export interface ImportWorkerOptions {
  database: Database;
  pool: DatabasePool;
  audit: AuditLog;
  authorization: AuthorizationService;
  notifications: NotificationService;
  encryption: Encryption;
  atlassian: AtlassianDirectory;
  uploads: UploadService;
  readers: ImportReaderRegistry;
  pipeline: ImportPipeline;
  folder: ImportFolder;
  jobs: JobQueue | undefined;
  logger: Logger;
  segmentMs?: number;
}

export class ImportWorker {
  readonly #options: ImportWorkerOptions;

  constructor(options: ImportWorkerOptions) {
    this.#options = options;
  }

  get #database(): Database {
    return this.#options.database;
  }

  async #load(importId: string): Promise<WorkRow | null> {
    const result = await this.#database.execute<WorkRow>(sql`
      select i.*, o.slug as organization_slug from imports i join organizations o on o.id = i.organization_id
      where i.id = ${importId}`);
    return result.rows[0] ?? null;
  }

  async #signal(row: Pick<WorkRow, "id" | "organization_id">): Promise<void> {
    await signalImportChange(this.#database, { importId: row.id, organizationId: row.organization_id });
  }

  async #lock(importId: string): Promise<(() => Promise<void>) | null> {
    const client = await this.#options.pool.connect();
    try {
      const result = await client.query<{ locked: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1, 0)) as locked",
        [`pagehall.import:${importId}`],
      );
      if (!result.rows[0]?.locked) {
        client.release();
        return null;
      }
    } catch (error) {
      client.release(error as Error);
      throw error;
    }
    return async () => {
      try {
        await client.query("select pg_advisory_unlock(hashtextextended($1, 0))", [
          `pagehall.import:${importId}`,
        ]);
        client.release();
      } catch (error) {
        client.release(error as Error);
      }
    };
  }

  readonly work = async (job: JobContext<{ importId: string }>): Promise<void> => {
    const importId = job.payload.importId;
    const unlock = await this.#lock(importId);
    if (!unlock) return;
    const deadline = Date.now() + (this.#options.segmentMs ?? SEGMENT_MS);
    try {
      for (let pass = 0; pass < 20; pass++) {
        const row = await this.#load(importId);
        if (!row) return;
        if (row.state === "analyzing") await this.#analyze(row, job.signal, deadline);
        else if (row.state === "running") await this.#run(row, job.signal, deadline);
        else if (row.state === "stopping" || row.state === "discarding") await this.#purge(row, job.signal);
        else return;
      }
    } catch (error) {
      if (error instanceof ImportYieldError) {
        await this.#continue(importId);
        return;
      }
      if (error instanceof ImportHeldError) return;
      if (job.signal.aborted) throw error;
      if (job.retryCount >= importWorkJob.retryLimit) {
        this.#options.logger.error({ err: error, importId }, "An import failed after all retries");
        await this.#fail(importId, "internalError");
        return;
      }
      this.#options.logger.warn({ err: error, importId }, "An import step failed and is retried");
      throw error;
    } finally {
      await unlock();
    }
  };

  async #continue(importId: string): Promise<void> {
    await this.#options.jobs?.enqueue(
      importWorkJob,
      { importId },
      { idempotencyKey: `${importId}:${randomUUID()}` },
    );
  }

  async #source(row: WorkRow): Promise<ByteSource> {
    if (row.file_kind === "upload" && row.upload_id) return this.#options.uploads.source(row.upload_id);
    if (row.file_kind === "folder" && row.folder_file) {
      const file = await this.#options.folder.open(row.organization_slug, row.folder_file);
      const expected = row.found?.file as { size?: number; modifiedAt?: string } | undefined;
      if (expected && (expected.size !== file.size || expected.modifiedAt !== file.modifiedAt)) {
        await file.close();
        throw new ImportFormatError(
          "fileChanged",
          "The file in the import folder changed after it was read.",
        );
      }
      return file;
    }
    throw new ImportFormatError("fileMissing", "Choose the export file first.");
  }

  #reader(row: WorkRow) {
    return this.#options.readers.get(row.source as ImportSource);
  }

  async #analyze(row: WorkRow, signal: AbortSignal, deadline: number): Promise<void> {
    const runId = typeof row.checkpoint.run === "string" ? row.checkpoint.run : randomUUID();
    if (row.checkpoint.run !== runId) {
      await this.#database.execute(sql`
        update imports set checkpoint = ${JSON.stringify({ run: runId })}::jsonb where id = ${row.id} and state = 'analyzing'`);
    }
    const scanCheckpoint = (row.checkpoint.scan as Record<string, unknown> | undefined) ?? null;
    const staging = new StagingStore(this.#database, row.id);
    if (!scanCheckpoint) {
      await staging.clear();
      await this.#database.execute(sql`delete from import_problems where import_id = ${row.id}`);
    }
    let file: ByteSource;
    try {
      file = await this.#source(row);
    } catch (error) {
      if (error instanceof ImportError) return this.#analysisFailed(row, runId, error.code);
      throw error;
    }
    let lastProgress = 0;
    try {
      const reader = this.#reader(row);
      await reader.scan(file, {
        staging,
        checkpoint: scanCheckpoint ?? {},
        signal,
        saveCheckpoint: async (checkpoint) => {
          const updated = await this.#database.execute(sql`
            update imports set checkpoint = ${JSON.stringify({ run: runId, scan: checkpoint })}::jsonb,
              heartbeat_at = now()
            where id = ${row.id} and state = 'analyzing' and checkpoint ->> 'run' = ${runId}`);
          if (updated.rowCount === 0) throw new ImportYieldError();
          if (Date.now() > deadline) throw new ImportYieldError();
        },
        progress: async (progress) => {
          if (Date.now() - lastProgress < PROGRESS_MS) return;
          lastProgress = Date.now();
          await this.#database.execute(sql`
            update imports set progress_done = ${Math.round(progress.done)}, progress_total = ${Math.round(progress.total)},
              heartbeat_at = now()
            where id = ${row.id} and state = 'analyzing'`);
          await this.#signal(row);
        },
        problem: async (code, details) => {
          if (!(problemCodes as string[]).includes(code)) return;
          await recordProblems(this.#database, row.id, [
            { code: code as ProblemCode, details: details ?? {} },
          ]);
        },
      });
      const summary = await reader.summary({ staging });
      const macroKinds = await this.#macroKinds(row.id);
      const fileInfo =
        row.file_kind === "folder" && "modifiedAt" in file
          ? { size: file.size, modifiedAt: (file as ByteSource & { modifiedAt: string }).modifiedAt }
          : { size: file.size };
      const key = row.space_key ?? (await this.#suggestKey(summary.spaceKey, summary.spaceName));
      const updated = await this.#database.execute(sql`
        update imports set state = 'ready', phase = null, error_code = null,
          found = ${JSON.stringify({ ...summary, macroKinds, file: fileInfo })}::jsonb,
          space_name = coalesce(space_name, ${summary.spaceName.slice(0, 100) || null}),
          space_key = ${key}, progress_done = progress_total, updated_at = now()
        where id = ${row.id} and state = 'analyzing' and checkpoint ->> 'run' = ${runId}`);
      if (updated.rowCount === 0) return;
      await this.#signal(row);
    } catch (error) {
      if (error instanceof ImportFormatError) return this.#analysisFailed(row, runId, error.code);
      throw error;
    } finally {
      await file.close();
    }
  }

  async #macroKinds(importId: string): Promise<number> {
    const result = await this.#database.execute<{ count: number }>(sql`
      select count(distinct m[1])::int as count
      from import_records b join import_records p
        on p.import_id = b.import_id and p.kind = 'page' and p.source_id = b.ref
      cross join lateral regexp_matches(b.data ->> 'body', '<ac:structured-macro[^>]*ac:name="([^"]+)"', 'g') as m
      where b.import_id = ${importId} and b.kind = 'body'`);
    return result.rows[0]?.count ?? 0;
  }

  async #suggestKey(exportKey: string, name: string): Promise<string | null> {
    const normalized = normalizeSpaceKey(exportKey);
    const base = isValidSpaceKey(normalized) ? normalized : suggestSpaceKey(name || "Import");
    for (const candidate of spaceKeyCandidates(base)) {
      const taken = await this.#database.execute<{ taken: boolean }>(sql`
        select exists (select 1 from spaces where key = ${candidate})
          or exists (select 1 from imports where space_key = ${candidate} and state in ('ready', 'running', 'held', 'review'))
          as taken`);
      if (!taken.rows[0]?.taken) return candidate;
    }
    return null;
  }

  async #analysisFailed(row: WorkRow, runId: string, code: string): Promise<void> {
    await this.#database.execute(sql`
      update imports set state = 'draft', phase = null, error_code = ${code}, updated_at = now()
      where id = ${row.id} and state = 'analyzing' and checkpoint ->> 'run' = ${runId}`);
    await this.#signal(row);
  }

  async #run(row: WorkRow, signal: AbortSignal, deadline: number): Promise<void> {
    let file: ByteSource;
    try {
      file = await this.#source(row);
    } catch (error) {
      if (error instanceof ImportError) return this.#fail(row.id, error.code);
      throw error;
    }
    const reader = this.#reader(row);
    const staging = new StagingStore(this.#database, row.id);
    const reviewers = (
      await this.#database.execute<{ account_id: string }>(
        sql`select account_id from import_reviewers where import_id = ${row.id}`,
      )
    ).rows.map((reviewer) => reviewer.account_id);
    const directory = directoryFor({
      database: this.#database,
      encryption: this.#options.encryption,
      atlassian: this.#options.atlassian,
      audit: this.#options.audit,
      importId: row.id,
      organizationId: row.organization_id,
      peopleSource: row.people_source,
    });
    let lastBeat = 0;
    let lastPermission = Date.now();
    let lastProgress = 0;
    const beat = async () => {
      signal.throwIfAborted();
      if (Date.now() - lastBeat < BEAT_MS) return;
      lastBeat = Date.now();
      const current = await this.#database.execute<{ state: ImportState }>(sql`
        update imports set heartbeat_at = now() where id = ${row.id} returning state`);
      if (current.rows[0]?.state !== "running") throw new ImportStoppedError();
      if (Date.now() - lastPermission > PERMISSION_CHECK_MS) {
        lastPermission = Date.now();
        await this.#requireImporter(row);
      }
      if (Date.now() > deadline) throw new ImportYieldError();
    };
    try {
      await this.#requireImporter(row);
      const start =
        row.phase === PHASES_DONE
          ? pipelinePhases.length
          : Math.max(0, pipelinePhases.indexOf((row.phase ?? "space") as PipelinePhase));
      for (const [index, phase] of pipelinePhases.entries()) {
        if (index < start) continue;
        await this.#database.execute(sql`
          update imports set phase = ${phase}, progress_done = 0, progress_total = 0, heartbeat_at = now()
          where id = ${row.id} and state = 'running' and phase is distinct from ${phase}`);
        await this.#signal(row);
        await this.#options.pipeline.runPhase(phase, {
          importId: row.id,
          organizationId: row.organization_id,
          importerId: row.importer_id,
          reviewerIds: reviewers,
          spaceName: row.space_name ?? "",
          spaceKey: row.space_key ?? "",
          sourceUrl: row.source_url,
          history: row.history,
          directory,
          reader,
          file,
          staging,
          beat,
          progress: async (done, total) => {
            if (Date.now() - lastProgress < PROGRESS_MS && done < total) return;
            lastProgress = Date.now();
            await this.#database.execute(sql`
              update imports set progress_done = ${done}, progress_total = ${total}
              where id = ${row.id} and state = 'running'`);
            await this.#signal(row);
          },
        });
        await this.#database.execute(sql`
          update imports set phase = ${pipelinePhases[index + 1] ?? PHASES_DONE}
          where id = ${row.id} and state = 'running'`);
        await beat();
      }
      await this.#finished(row);
    } catch (error) {
      if (error instanceof ImportStoppedError) return;
      if (error instanceof ImportFormatError) return this.#fail(row.id, error.code);
      throw error;
    } finally {
      await file.close();
    }
  }

  async #requireImporter(row: WorkRow): Promise<void> {
    const decision = await this.#options.authorization.explain(
      accountPrincipal(row.importer_id),
      "organization.imports.manage",
      { type: "organization", id: row.organization_id },
      { fresh: true },
    );
    if (decision.allowed) return;
    await this.#database.transaction(async (tx) => {
      const updated = await tx.execute(sql`
        update imports set state = 'held', updated_at = now() where id = ${row.id} and state = 'running'`);
      if (updated.rowCount === 0) return;
      const administrators = await tx.execute<{ account_id: string }>(sql`
        select distinct a.id as account_id from role_assignments ra
        left join custom_roles cr on cr.id = ra.custom_role_id
        join accounts a on a.state = 'active' and (
          (ra.principal_kind = 'account' and a.id = ra.principal_id)
          or (ra.principal_kind = 'group' and exists (select 1 from group_members gm
            where gm.group_id = ra.principal_id and gm.account_id = a.id
              and (gm.expires_at is null or gm.expires_at > now()))))
        where ra.scope = 'organization' and ra.organization_id = ${row.organization_id}
          and (ra.expires_at is null or ra.expires_at > now())
          and (ra.built_in_role in ('owner', 'administrator') or cr.areas ->> 'spaces' = 'manage')
          and a.id <> ${row.importer_id}`);
      if (administrators.rows.length > 0) {
        await this.#options.notifications.notify(tx, {
          type: "import.held",
          recipients: administrators.rows.map((administrator) => administrator.account_id),
          organizationId: row.organization_id,
          targetId: row.id,
          actor: SYSTEM,
          params: { spaceKey: row.space_key ?? "" },
        });
      }
      await signalImportChange(tx, { importId: row.id, organizationId: row.organization_id });
    });
    throw new ImportHeldError();
  }

  async #finished(row: WorkRow): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const updated = await tx.execute<{ counts: Record<string, number> }>(sql`
        update imports set state = 'review', phase = null, finished_at = now(), updated_at = now()
        where id = ${row.id} and state = 'running' returning counts`);
      const counts = updated.rows[0]?.counts;
      if (!counts) return;
      await this.#options.notifications.notify(tx, {
        type: "import.finished",
        recipients: [row.importer_id],
        organizationId: row.organization_id,
        targetId: row.id,
        actor: SYSTEM,
        params: {
          spaceKey: row.space_key ?? "",
          spaceName: row.space_name ?? "",
          problems: Number(counts.problems ?? 0),
        },
      });
      await signalImportChange(tx, { importId: row.id, organizationId: row.organization_id });
    });
  }

  async #fail(importId: string, code: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const updated = await tx.execute<WorkRow>(sql`
        update imports set
          state = case when state = 'analyzing' then 'draft'::import_state else 'failed'::import_state end,
          error_code = ${code}, finished_at = case when state = 'analyzing' then finished_at else now() end,
          updated_at = now()
        where id = ${importId} and state in ('analyzing', 'running', 'held')
        returning *`);
      const row = updated.rows[0];
      if (!row) return;
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
      if (row.state !== "failed") return;
      await deleteCredentials(tx, this.#options.audit, {
        importId,
        organizationId: row.organization_id,
        reason: "failed",
      });
      await this.#options.audit.record(tx, {
        name: "import.failed",
        actor: SYSTEM,
        targetId: importId,
        fields: { phase: row.phase, reason: code },
        scope: { type: "organization", id: row.organization_id },
      });
      await this.#options.notifications.notify(tx, {
        type: "import.failed",
        recipients: [row.importer_id],
        organizationId: row.organization_id,
        targetId: importId,
        actor: SYSTEM,
        params: { spaceKey: row.space_key ?? "", spaceName: row.space_name ?? "", errorCode: code },
      });
    });
  }

  async #purge(row: WorkRow, signal: AbortSignal): Promise<void> {
    if (row.quarantine_space_id) {
      await purgeQuarantineSpace(this.#database, row.quarantine_space_id, signal, async (removed) => {
        await this.#database.execute(sql`
          update imports set heartbeat_at = now(), progress_done = ${removed} where id = ${row.id}`);
        await this.#signal(row);
      });
    }
    await this.#database.transaction(async (tx) => {
      const final = row.state === "stopping" ? "stopped" : "discarded";
      await tx.execute(sql`delete from import_records where import_id = ${row.id}`);
      await tx.execute(sql`delete from import_items where import_id = ${row.id}`);
      await tx.execute(sql`delete from import_problems where import_id = ${row.id}`);
      await tx.execute(sql`delete from import_grants where import_id = ${row.id}`);
      await tx.execute(sql`delete from import_groups where import_id = ${row.id}`);
      await deleteCredentials(tx, this.#options.audit, {
        importId: row.id,
        organizationId: row.organization_id,
        reason: final,
      });
      await tx.execute(sql`
        update imports set state = ${final}, phase = null, quarantine_space_id = null,
          decided_at = coalesce(decided_at, now()),
          file_expires_at = now() + make_interval(days => ${FILE_RETENTION_DAYS}), updated_at = now()
        where id = ${row.id} and state = ${row.state}`);
      if (row.upload_id) {
        await tx.execute(sql`
          update import_uploads set expires_at = now() + make_interval(days => ${FILE_RETENTION_DAYS})
          where id = ${row.upload_id}`);
      }
      await signalImportChange(tx, { importId: row.id, organizationId: row.organization_id });
    });
  }

  async watchdog(): Promise<number> {
    const stale = await this.#database.execute<{ id: string }>(sql`
      select id from imports
      where state in ('analyzing', 'running', 'stopping', 'discarding')
        and coalesce(heartbeat_at, updated_at) < now() - make_interval(mins => ${STALE_MINUTES})
      limit 100`);
    for (const row of stale.rows) await this.#continue(row.id);
    return stale.rows.length;
  }
}
