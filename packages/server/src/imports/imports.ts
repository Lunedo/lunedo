import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { JobQueue } from "../jobs/job-queue.js";
import type { GroupService } from "../organizations/groups.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf, auditScopeOf, mergeGrants } from "../spaces/common.js";
import type { SpaceGrant } from "../spaces/settings.js";
import { signalSpaceChange } from "../spaces/signals.js";
import { cleanKey, type HolderValidation, insertGrants, SPACE_NAME_MAX_LENGTH } from "../spaces/spaces.js";
import { visibleItem } from "../spaces/visibility.js";
import { type AtlassianDirectory, atlassianHostsSetting, atlassianSite } from "./atlassian.js";
import { deleteCredentials, tokenContext } from "./credentials.js";
import { ImportError } from "./errors.js";
import { type FolderFile, ImportFolder, isSafeFolderName } from "./folder.js";
import { spreadsheetCell } from "./formats/csv.js";
import { importWorkJob } from "./jobs.js";
import { createQuarantineSpace, setQuarantineReaders } from "./quarantine.js";
import { type ReportCategory, reportCategoryNames } from "./report.js";
import { ImportResolutionService } from "./resolution.js";
import type { ImportState } from "./schema.js";
import { importFolderSetting } from "./settings.js";
import { signalImportChange } from "./signals.js";
import { type ImportSource, importSources } from "./source.js";
import type { UploadService } from "./uploads.js";
import { parseUserList } from "./user-list.js";

export const MAX_REVIEWERS = 50;
export const FILE_RETENTION_DAYS = 7;
const SOURCE_URL_MAX_LENGTH = 500;

const EDITABLE: readonly ImportState[] = ["draft", "analyzing", "ready"];
const STARTED: readonly ImportState[] = ["running", "held", "stopping", "review", "accepting", "failed"];
const FINAL: readonly ImportState[] = ["accepted", "discarded", "stopped"];

export interface ImportPerson {
  readonly id: string;
  readonly name: string;
}

export interface ImportFileView {
  readonly kind: "upload" | "folder";
  readonly name: string;
  readonly size: number | null;
  readonly uploadId: string | null;
  readonly complete: boolean;
}

export interface ImportFound {
  readonly pages: number;
  readonly blogPosts: number;
  readonly versions: number;
  readonly comments: number;
  readonly likes: number;
  readonly watchers: number;
  readonly attachments: number;
  readonly attachmentBytes: number;
  readonly people: number;
  readonly macroKinds: number;
  readonly spaceKey: string;
  readonly spaceName: string;
}

export interface ImportView {
  readonly id: string;
  readonly organizationId: string;
  readonly importer: ImportPerson;
  readonly source: ImportSource;
  readonly state: ImportState;
  readonly draftStep: number;
  readonly file: ImportFileView | null;
  readonly spaceName: string | null;
  readonly spaceKey: string | null;
  readonly archived: boolean;
  readonly history: boolean;
  readonly peopleSource: PeopleSourceView | null;
  readonly tokenDeletedAt: Date | null;
  readonly sourceUrl: string | null;
  readonly reviewers: readonly ImportPerson[];
  readonly phase: string | null;
  readonly progress: { readonly done: number; readonly total: number };
  readonly found: ImportFound | null;
  readonly counts: Readonly<Record<string, number>>;
  readonly errorCode: string | null;
  readonly quarantineSpace: { readonly id: string; readonly key: string } | null;
  readonly canManage: boolean;
  readonly canTakeOver: boolean;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly decidedAt: Date | null;
  readonly fileExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PeopleSourceView {
  readonly kind: "token" | "list" | "skip";
  readonly site: string | null;
  readonly email: string | null;
  readonly people: number | null;
  readonly withEmail: number | null;
}

export type PeopleSourceInput =
  | { kind: "token"; site: string; email: string; token: string }
  | { kind: "list"; userList: string }
  | { kind: "skip"; confirmed: boolean };

export interface ImportUpdate {
  readonly source?: ImportSource | undefined;
  readonly draftStep?: number | undefined;
  readonly file?: { kind: "upload"; uploadId: string } | { kind: "folder"; name: string } | null | undefined;
  readonly spaceName?: string | undefined;
  readonly spaceKey?: string | undefined;
  readonly archived?: boolean | undefined;
  readonly history?: boolean | undefined;
  readonly sourceUrl?: string | null | undefined;
}

export interface ReportSummary {
  readonly categories: readonly {
    readonly category: ReportCategory;
    readonly code: string;
    readonly count: number;
  }[];
  readonly total: number;
  readonly placeholders: number;
  readonly mapped: number;
  readonly permissionsToCheck: number;
  readonly groupsMissing: number;
}

export interface ReportEntry {
  readonly id: string;
  readonly category: string;
  readonly code: string;
  readonly item: { readonly id: string; readonly title: string | null } | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface MacroUsage {
  readonly name: string;
  readonly pages: number;
  readonly occurrences: number;
}

type ImportRow = Record<string, unknown> & {
  id: string;
  organization_id: string;
  importer_id: string;
  importer_name: string;
  source: string;
  state: ImportState;
  draft_step: number;
  file_kind: "upload" | "folder" | null;
  upload_id: string | null;
  upload_name: string | null;
  upload_size: string | number | null;
  upload_complete: boolean | null;
  folder_file: string | null;
  space_name: string | null;
  space_key: string | null;
  archived: boolean;
  history: boolean;
  people_source: "token" | "list" | "skip" | null;
  token_deleted_at: Date | string | null;
  credential_site: string | null;
  credential_email: string | null;
  credential_people: number | null;
  credential_with_email: number | null;
  directory_people: number | null;
  directory_with_email: number | null;
  source_url: string | null;
  phase: string | null;
  progress_done: number;
  progress_total: number;
  found: ImportFound | null;
  counts: Record<string, number>;
  error_code: string | null;
  quarantine_space_id: string | null;
  quarantine_key: string | null;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  decided_at: Date | string | null;
  file_expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const SELECT = sql`
  select i.*, a.name as importer_name, u.name as upload_name, u.size as upload_size, u.complete as upload_complete,
    s.key as quarantine_key, c.site as credential_site, c.email as credential_email,
    c.people as credential_people, c.with_email as credential_with_email,
    (select count(*)::int from import_directory d where d.import_id = i.id) as directory_people,
    (select count(d.email)::int from import_directory d where d.import_id = i.id) as directory_with_email
  from imports i join accounts a on a.id = i.importer_id
  left join import_uploads u on u.id = i.upload_id
  left join spaces s on s.id = i.quarantine_space_id
  left join import_credentials c on c.import_id = i.id`;

function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

export function cleanSpaceName(name: string): string {
  const value = name.replace(/\s+/g, " ").trim();
  if (value.length === 0 || value.length > SPACE_NAME_MAX_LENGTH) {
    throw new ImportError("invalidSpaceName", `The name needs 1 to ${SPACE_NAME_MAX_LENGTH} characters.`);
  }
  return value;
}

export function cleanSourceUrl(url: string | null): string | null {
  if (url === null) return null;
  const value = url.trim();
  if (value.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ImportError(
      "invalidSourceUrl",
      "Enter the address of the Confluence site, starting with https://.",
    );
  }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || value.length > SOURCE_URL_MAX_LENGTH) {
    throw new ImportError(
      "invalidSourceUrl",
      "Enter the address of the Confluence site, starting with https://.",
    );
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

export class ImportService {
  readonly #database: Database;
  readonly #authorization: AuthorizationService;
  readonly #audit: AuditLog;
  readonly #settings: SettingsService;
  readonly #uploads: UploadService;
  readonly #jobs: JobQueue | undefined;
  readonly #folder: ImportFolder;
  readonly #holders: HolderValidation;
  readonly #encryption: Encryption;
  readonly #atlassian: AtlassianDirectory;
  readonly resolution: ImportResolutionService;

  constructor(options: {
    database: Database;
    authorization: AuthorizationService;
    audit: AuditLog;
    settings: SettingsService;
    encryption: Encryption;
    atlassian: AtlassianDirectory;
    groups: GroupService;
    uploads: UploadService;
    jobs: JobQueue | undefined;
    importDir: string;
    holders: HolderValidation;
  }) {
    this.#database = options.database;
    this.#authorization = options.authorization;
    this.#audit = options.audit;
    this.#settings = options.settings;
    this.#uploads = options.uploads;
    this.#jobs = options.jobs;
    this.#folder = new ImportFolder(options.importDir);
    this.#holders = options.holders;
    this.#encryption = options.encryption;
    this.#atlassian = options.atlassian;
    this.resolution = new ImportResolutionService({
      database: options.database,
      authorization: options.authorization,
      audit: options.audit,
      groups: options.groups,
      holders: options.holders,
    });
  }

  get folder(): ImportFolder {
    return this.#folder;
  }

  async #enqueue(importId: string): Promise<void> {
    await this.#jobs?.enqueue(importWorkJob, { importId }, { idempotencyKey: `${importId}:${uuidv7()}` });
  }

  async #row(executor: Executor, importId: string): Promise<ImportRow> {
    const result = await executor.execute<ImportRow>(sql`${SELECT} where i.id = ${importId}`);
    const row = result.rows[0];
    if (!row) throw new ImportError("importNotFound", "The import does not exist.");
    return row;
  }

  async #locked(tx: Transaction, importId: string): Promise<ImportRow> {
    await tx.execute(sql`select id from imports where id = ${importId} for update`);
    return this.#row(tx, importId);
  }

  async #reviewers(executor: Executor, importIds: readonly string[]): Promise<Map<string, ImportPerson[]>> {
    const result = new Map<string, ImportPerson[]>();
    if (importIds.length === 0) return result;
    const rows = await executor.execute<{ import_id: string; id: string; name: string }>(sql`
      select r.import_id, a.id, a.name from import_reviewers r join accounts a on a.id = r.account_id
      where r.import_id = any(${sql.param([...importIds])}::uuid[]) order by lower(a.name), a.id`);
    for (const row of rows.rows) {
      const list = result.get(row.import_id) ?? [];
      list.push({ id: row.id, name: row.name });
      result.set(row.import_id, list);
    }
    return result;
  }

  async #view(viewer: Principal, row: ImportRow, reviewers: readonly ImportPerson[]): Promise<ImportView> {
    const resource = { type: "import", id: row.id };
    const canManage = (await this.#authorization.explain(viewer, "import.manage", resource)).allowed;
    const canTakeOver = (await this.#authorization.explain(viewer, "import.takeOver", resource)).allowed;
    const file: ImportFileView | null =
      row.file_kind === "upload" && row.upload_id
        ? {
            kind: "upload",
            name: row.upload_name ?? "",
            size: row.upload_size === null ? null : Number(row.upload_size),
            uploadId: row.upload_id,
            complete: row.upload_complete === true,
          }
        : row.file_kind === "folder" && row.folder_file
          ? { kind: "folder", name: row.folder_file, size: null, uploadId: null, complete: true }
          : null;
    return {
      id: row.id,
      organizationId: row.organization_id,
      importer: { id: row.importer_id, name: row.importer_name },
      source: row.source as ImportSource,
      state: row.state,
      draftStep: row.draft_step,
      file,
      spaceName: row.space_name,
      spaceKey: row.space_key,
      archived: row.archived,
      history: row.history,
      peopleSource: row.people_source
        ? {
            kind: row.people_source,
            site: row.people_source === "token" ? row.credential_site : null,
            email: row.people_source === "token" ? row.credential_email : null,
            people:
              row.people_source === "token"
                ? row.credential_people
                : row.people_source === "list"
                  ? row.directory_people
                  : null,
            withEmail:
              row.people_source === "token"
                ? row.credential_with_email
                : row.people_source === "list"
                  ? row.directory_with_email
                  : null,
          }
        : null,
      tokenDeletedAt: date(row.token_deleted_at),
      sourceUrl: row.source_url,
      reviewers,
      phase: row.phase,
      progress: { done: row.progress_done, total: row.progress_total },
      found: row.found,
      counts: row.counts ?? {},
      errorCode: row.error_code,
      quarantineSpace:
        row.quarantine_space_id && row.quarantine_key
          ? { id: row.quarantine_space_id, key: row.quarantine_key }
          : null,
      canManage,
      canTakeOver,
      startedAt: date(row.started_at),
      finishedAt: date(row.finished_at),
      decidedAt: date(row.decided_at),
      fileExpiresAt: date(row.file_expires_at),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  async #visible(viewer: Principal, importId: string): Promise<void> {
    const resource = { type: "import", id: importId };
    if ((await this.#authorization.explain(viewer, "import.view", resource)).allowed) return;
    await this.#authorization.require(viewer, "import.takeOver", resource);
  }

  async list(viewer: Principal, organizationId: string): Promise<ImportView[]> {
    const viewerId = actorIdOf(viewer);
    const result = await this.#database.execute<ImportRow>(sql`
      ${SELECT}
      where i.organization_id = ${organizationId}
        and (i.importer_id = ${viewerId} or i.state = 'held'
          or (exists (select 1 from import_reviewers r where r.import_id = i.id and r.account_id = ${viewerId})
            and i.state not in ('draft', 'analyzing', 'ready')))
      order by i.created_at desc, i.id
      limit 200`);
    const reviewers = await this.#reviewers(
      this.#database,
      result.rows.map((row) => row.id),
    );
    const views: ImportView[] = [];
    for (const row of result.rows) {
      const resource = { type: "import", id: row.id };
      const view = (await this.#authorization.explain(viewer, "import.view", resource)).allowed;
      const takeOver =
        !view && (await this.#authorization.explain(viewer, "import.takeOver", resource)).allowed;
      if (view || takeOver) views.push(await this.#view(viewer, row, reviewers.get(row.id) ?? []));
    }
    return views;
  }

  async get(viewer: Principal, importId: string): Promise<ImportView> {
    await this.#visible(viewer, importId);
    const row = await this.#row(this.#database, importId);
    if (EDITABLE.includes(row.state) && row.importer_id !== actorIdOf(viewer)) {
      throw new ImportError("importNotFound", "The import does not exist.");
    }
    const reviewers = await this.#reviewers(this.#database, [importId]);
    return this.#view(viewer, row, reviewers.get(importId) ?? []);
  }

  async create(
    actor: Principal,
    organizationId: string,
    input: { source: ImportSource },
  ): Promise<ImportView> {
    await this.#authorization.require(actor, "organization.imports.manage", {
      type: "organization",
      id: organizationId,
    });
    const importerId = actorIdOf(actor);
    if (!importerId) throw new ImportError("accountRequired", "Only people can import.");
    const id = uuidv7();
    await this.#database.execute(sql`
      insert into imports (id, organization_id, importer_id, source) values (${id}, ${organizationId}, ${importerId}, ${input.source})`);
    return this.get(actor, id);
  }

  async update(actor: Principal, importId: string, input: ImportUpdate): Promise<ImportView> {
    await this.#authorization.require(actor, "import.manage", { type: "import", id: importId });
    let analyze = false;
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (!EDITABLE.includes(row.state)) {
        throw new ImportError("importStarted", "The import has started; its settings cannot change anymore.");
      }
      const changes: ReturnType<typeof sql>[] = [];
      let fileChanged = false;
      if (input.source !== undefined && input.source !== row.source) {
        if (!importSources.includes(input.source))
          throw new ImportError("invalidSource", "Choose an export format.");
        changes.push(sql`source = ${input.source}`);
        fileChanged = true;
      }
      if (input.draftStep !== undefined)
        changes.push(sql`draft_step = ${Math.max(0, Math.min(10, input.draftStep))}`);
      if (input.file !== undefined) {
        if (input.file === null) {
          changes.push(sql`file_kind = null, upload_id = null, folder_file = null`);
        } else if (input.file.kind === "upload") {
          const upload = await this.#uploads.get(actor, input.file.uploadId);
          if (upload.organizationId !== row.organization_id) {
            throw new ImportError("uploadNotFound", "The upload does not exist.");
          }
          changes.push(sql`file_kind = 'upload', upload_id = ${upload.id}, folder_file = null`);
        } else {
          await this.#requireFolderFile(tx, row.organization_id, input.file.name);
          changes.push(sql`file_kind = 'folder', upload_id = null, folder_file = ${input.file.name}`);
        }
        fileChanged = true;
      }
      if (input.spaceName !== undefined) changes.push(sql`space_name = ${cleanSpaceName(input.spaceName)}`);
      if (input.spaceKey !== undefined) {
        let key: string;
        try {
          key = cleanKey(input.spaceKey);
        } catch {
          throw new ImportError("invalidSpaceKey", "The key needs 2 to 10 letters or digits.");
        }
        changes.push(sql`space_key = ${key}`);
      }
      if (input.archived !== undefined) changes.push(sql`archived = ${input.archived}`);
      if (input.history !== undefined) changes.push(sql`history = ${input.history}`);
      if (input.sourceUrl !== undefined) changes.push(sql`source_url = ${cleanSourceUrl(input.sourceUrl)}`);
      if (fileChanged) {
        changes.push(
          sql`found = null, error_code = null, checkpoint = '{}'::jsonb, progress_done = 0, progress_total = 0`,
        );
        await tx.execute(sql`delete from import_records where import_id = ${importId}`);
        await tx.execute(sql`delete from import_problems where import_id = ${importId}`);
      }
      if (changes.length === 0) return;
      await tx.execute(
        sql`update imports set ${sql.join(changes, sql`, `)}, updated_at = now() where id = ${importId}`,
      );
      if (fileChanged) {
        const updated = await this.#row(tx, importId);
        analyze =
          updated.file_kind === "folder" ||
          (updated.file_kind === "upload" && updated.upload_complete === true);
        await tx.execute(
          sql`update imports set state = ${analyze ? "analyzing" : "draft"}, phase = ${analyze ? "read" : null}
              where id = ${importId}`,
        );
      }
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    if (analyze) await this.#enqueue(importId);
    return this.get(actor, importId);
  }

  async #organizationSlug(executor: Executor, organizationId: string): Promise<string> {
    const result = await executor.execute<{ slug: string }>(
      sql`select slug from organizations where id = ${organizationId}`,
    );
    const slug = result.rows[0]?.slug;
    if (slug === undefined)
      throw new ImportError("importFolderUnavailable", "The organization does not exist.");
    return slug;
  }

  async #requireFolderFile(executor: Executor, organizationId: string, name: string): Promise<FolderFile> {
    if (!(await this.#settings.get(importFolderSetting, {}))) {
      throw new ImportError(
        "importFolderDisabled",
        "Imports from the import folder are turned off for this instance.",
      );
    }
    if (!isSafeFolderName(name))
      throw new ImportError("importFileUnavailable", "The file is not in the import folder.");
    const slug = await this.#organizationSlug(executor, organizationId);
    const file = (await this.#folder.list(slug)).find((candidate) => candidate.name === name);
    if (!file) throw new ImportError("importFileUnavailable", "The file is not in the import folder.");
    return file;
  }

  async listFolder(
    actor: Principal,
    organizationId: string,
  ): Promise<{ enabled: boolean; path: string; files: FolderFile[]; maxUploadBytes: number }> {
    await this.#authorization.require(actor, "organization.imports.manage", {
      type: "organization",
      id: organizationId,
    });
    const maxUploadBytes = await this.#uploads.maxBytes();
    const slug = await this.#organizationSlug(this.#database, organizationId);
    const folderPath = this.#folder.pathFor(slug);
    if (!(await this.#settings.get(importFolderSetting, {})))
      return { enabled: false, path: folderPath, files: [], maxUploadBytes };
    return { enabled: true, path: folderPath, files: await this.#folder.list(slug), maxUploadBytes };
  }

  async setPeopleSource(actor: Principal, importId: string, input: PeopleSourceInput): Promise<ImportView> {
    await this.#authorization.require(actor, "import.manage", { type: "import", id: importId });
    const current = await this.#row(this.#database, importId);
    if (!EDITABLE.includes(current.state)) {
      throw new ImportError("importStarted", "The import has started; its settings cannot change anymore.");
    }
    if (input.kind === "token") {
      const site = atlassianSite(input.site, await this.#settings.get(atlassianHostsSetting, {}));
      const email = input.email.trim();
      const token = input.token.trim();
      if (!/^[^\s@]+@[^\s@]+$/.test(email) || email.length > 320) {
        throw new ImportError("invalidAtlassianEmail", "Enter the e-mail address of your Atlassian account.");
      }
      if (token.length === 0 || token.length > 1000 || /\s/.test(token)) {
        throw new ImportError("invalidAtlassianToken", "Paste the API token exactly as Atlassian showed it.");
      }
      const credentials = { site, email, token };
      await this.#atlassian.check(credentials);
      const ids = await this.#database.execute<{ account_id: string }>(sql`
        select distinct data ->> 'accountId' as account_id from import_records
        where import_id = ${importId} and kind = 'user' and data ->> 'accountId' is not null`);
      const found =
        ids.rows.length > 0
          ? await this.#atlassian.people(
              credentials,
              ids.rows.map((row) => row.account_id),
            )
          : null;
      await this.#database.transaction(async (tx) => {
        const row = await this.#locked(tx, importId);
        if (!EDITABLE.includes(row.state)) {
          throw new ImportError(
            "importStarted",
            "The import has started; its settings cannot change anymore.",
          );
        }
        await tx.execute(sql`delete from import_directory where import_id = ${importId}`);
        await tx.execute(sql`
          insert into import_credentials (import_id, site, email, token, people, with_email)
          values (${importId}, ${site}, ${email}, ${this.#encryption.encrypt(token, tokenContext(importId))},
            ${found ? found.length : null}, ${found ? found.filter((person) => person.email).length : null})
          on conflict (import_id) do update set site = excluded.site, email = excluded.email, token = excluded.token,
            people = excluded.people, with_email = excluded.with_email, created_at = now()`);
        await tx.execute(sql`
          update imports set people_source = 'token', token_deleted_at = null, updated_at = now() where id = ${importId}`);
        await this.#audit.record(tx, {
          name: "import.tokenUsed",
          actor,
          targetId: importId,
          fields: { site, purpose: "check" },
          scope: { type: "organization", id: row.organization_id },
        });
        await signalImportChange(tx, { importId, organizationId: row.organization_id });
      });
      return this.get(actor, importId);
    }
    if (input.kind === "skip" && !input.confirmed) {
      throw new ImportError(
        "skipNotConfirmed",
        "Confirm that every author becomes a placeholder until you upload a user list.",
      );
    }
    const entries = input.kind === "list" ? await parseUserList(input.userList) : [];
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (!EDITABLE.includes(row.state)) {
        throw new ImportError("importStarted", "The import has started; its settings cannot change anymore.");
      }
      await deleteCredentials(tx, this.#audit, {
        importId,
        organizationId: row.organization_id,
        reason: "replaced",
        actor,
      });
      for (let start = 0; start < entries.length; start += 1000) {
        const chunk = entries.slice(start, start + 1000).map((entry) => ({
          external_id: entry.externalId,
          name: entry.name,
          email: entry.email,
        }));
        await tx.execute(sql`
          insert into import_directory (import_id, external_id, name, email)
          select ${importId}, r.external_id, r.name, r.email
          from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as r(external_id text, name text, email text)
          on conflict do nothing`);
      }
      await tx.execute(
        sql`update imports set people_source = ${input.kind}, updated_at = now() where id = ${importId}`,
      );
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    return this.get(actor, importId);
  }

  async remove(actor: Principal, importId: string): Promise<void> {
    await this.#authorization.require(actor, "import.manage", { type: "import", id: importId });
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (!EDITABLE.includes(row.state)) {
        throw new ImportError(
          "importStarted",
          "A started import is stopped or discarded instead of removed.",
        );
      }
      await deleteCredentials(tx, this.#audit, {
        importId,
        organizationId: row.organization_id,
        reason: "removed",
        actor,
      });
      await tx.execute(sql`delete from imports where id = ${importId}`);
      if (row.upload_id) {
        await tx.execute(sql`
          update import_uploads set expires_at = least(expires_at, now() + make_interval(days => ${FILE_RETENTION_DAYS}))
          where id = ${row.upload_id}`);
      }
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
  }

  async #validReviewers(tx: Transaction, organizationId: string, importerId: string, ids: readonly string[]) {
    const unique = [...new Set(ids)].filter((id) => id !== importerId);
    if (unique.length > MAX_REVIEWERS) {
      throw new ImportError("tooManyReviewers", `An import can have up to ${MAX_REVIEWERS} reviewers.`);
    }
    if (unique.length === 0) return unique;
    const valid = await tx.execute<{ id: string }>(sql`
      select a.id from accounts a join memberships m on m.account_id = a.id
      where a.id = any(${sql.param(unique)}::uuid[]) and a.type = 'standard' and a.state = 'active'
        and m.organization_id = ${organizationId} and m.kind = 'member'
        and (m.expires_at is null or m.expires_at > now())`);
    if (valid.rows.length !== unique.length) {
      throw new ImportError("invalidReviewer", "Reviewers must be active members of the organization.");
    }
    return unique;
  }

  async setReviewers(actor: Principal, importId: string, accountIds: readonly string[]): Promise<ImportView> {
    await this.#authorization.require(actor, "import.manage", { type: "import", id: importId });
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (FINAL.includes(row.state) || row.state === "discarding") {
        throw new ImportError(
          "importFinished",
          "The import is finished; its reviewers cannot change anymore.",
        );
      }
      const wanted = await this.#validReviewers(tx, row.organization_id, row.importer_id, accountIds);
      const current = (
        await tx.execute<{ account_id: string }>(
          sql`select account_id from import_reviewers where import_id = ${importId}`,
        )
      ).rows.map((reviewer) => reviewer.account_id);
      const added = wanted.filter((id) => !current.includes(id));
      const removed = current.filter((id) => !wanted.includes(id));
      if (added.length === 0 && removed.length === 0) return;
      await tx.execute(sql`
        delete from import_reviewers where import_id = ${importId} and account_id = any(${sql.param(removed)}::uuid[])`);
      for (const id of added) {
        await tx.execute(sql`
          insert into import_reviewers (import_id, account_id, created_by) values (${importId}, ${id}, ${actorIdOf(actor)})`);
      }
      if (row.quarantine_space_id && !FINAL.includes(row.state)) {
        await setQuarantineReaders(tx, row.quarantine_space_id, row.importer_id, [
          row.importer_id,
          ...wanted,
        ]);
      }
      await this.#audit.record(tx, {
        name: "import.reviewersChanged",
        actor,
        targetId: importId,
        fields: { added, removed },
        scope: { type: "organization", id: row.organization_id },
      });
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    return this.get(actor, importId);
  }

  async start(actor: Principal, importId: string): Promise<ImportView> {
    await this.#authorization.require(actor, "import.manage", { type: "import", id: importId });
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (row.state !== "ready") {
        throw new ImportError(
          row.state === "analyzing" ? "importNotReady" : "importStarted",
          row.state === "analyzing"
            ? "Pagehall is still reading the export. Start the import when it is done."
            : "The import cannot be started in its current state.",
        );
      }
      if (!row.people_source) {
        throw new ImportError(
          "peopleSourceMissing",
          "Choose how Pagehall recognizes people: an API token, a user list, or skip with confirmation.",
        );
      }
      const name = cleanSpaceName(row.space_name ?? "");
      if (!row.space_key)
        throw new ImportError("invalidSpaceKey", "The key needs 2 to 10 letters or digits.");
      const key = cleanKey(row.space_key);
      const taken = await tx.execute<{ taken: boolean }>(
        sql`select exists (select 1 from spaces where key = ${key}) as taken`,
      );
      if (taken.rows[0]?.taken)
        throw new ImportError("keyTaken", "Another space uses this key. Choose another key.");
      const reviewers = (
        await tx.execute<{ account_id: string }>(
          sql`select account_id from import_reviewers where import_id = ${importId}`,
        )
      ).rows.map((reviewer) => reviewer.account_id);
      const space = await createQuarantineSpace(tx, {
        organizationId: row.organization_id,
        name,
        key,
        importerId: row.importer_id,
        readers: reviewers,
      });
      await tx.execute(sql`
        update imports set state = 'running', phase = 'space', quarantine_space_id = ${space.spaceId},
          checkpoint = '{}'::jsonb, progress_done = 0, progress_total = 0, started_at = now(), heartbeat_at = null,
          error_code = null, updated_at = now()
        where id = ${importId}`);
      await this.#audit.record(tx, {
        name: "import.started",
        actor,
        targetId: importId,
        fields: {
          source: row.source,
          spaceId: space.spaceId,
          spaceKey: key,
          archived: row.archived,
          reviewers: reviewers.length,
          file: row.file_kind === "folder" ? "folder" : "upload",
        },
        scope: { type: "organization", id: row.organization_id },
      });
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    await this.#enqueue(importId);
    return this.get(actor, importId);
  }

  async stop(actor: Principal, importId: string, confirmation: string): Promise<ImportView> {
    await this.#authorization.require(actor, "import.manage", { type: "import", id: importId });
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (row.state !== "running" && row.state !== "held") {
        throw new ImportError("importNotRunning", "The import is not running.");
      }
      this.#confirm(row, confirmation);
      await tx.execute(sql`
        update imports set state = 'stopping', stop_requested_at = now(), updated_at = now() where id = ${importId}`);
      await this.#audit.record(tx, {
        name: "import.stopped",
        actor,
        targetId: importId,
        fields: { spaceId: row.quarantine_space_id, phase: row.phase },
        scope: { type: "organization", id: row.organization_id },
      });
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    await this.#enqueue(importId);
    return this.get(actor, importId);
  }

  async discard(actor: Principal, importId: string, confirmation: string): Promise<ImportView> {
    await this.#authorization.require(actor, "import.manage", { type: "import", id: importId });
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (row.state !== "review" && row.state !== "failed") {
        throw new ImportError("importNotInReview", "Only a finished or failed import can be discarded.");
      }
      this.#confirm(row, confirmation);
      await tx.execute(
        sql`update imports set state = 'discarding', updated_at = now() where id = ${importId}`,
      );
      await this.#audit.record(tx, {
        name: "import.discarded",
        actor,
        targetId: importId,
        fields: { spaceId: row.quarantine_space_id },
        scope: { type: "organization", id: row.organization_id },
      });
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    await this.#enqueue(importId);
    return this.get(actor, importId);
  }

  #confirm(row: ImportRow, confirmation: string): void {
    const expected = row.quarantine_key ?? row.space_key ?? "";
    if (confirmation.trim().toUpperCase() !== expected.toUpperCase() || expected.length === 0) {
      throw new ImportError("confirmationMismatch", "Type the key of the space to confirm.");
    }
  }

  async accept(
    actor: Principal,
    importId: string,
    input: { visibility: "private" | "organization" | "instance"; grants: readonly SpaceGrant[] },
  ): Promise<ImportView> {
    await this.#authorization.require(actor, "import.manage", { type: "import", id: importId });
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (row.state !== "review")
        throw new ImportError("importNotInReview", "Only a finished import can be accepted.");
      const spaceId = row.quarantine_space_id;
      if (!spaceId) throw new ImportError("importNotInReview", "The quarantine space is missing.");
      const space = await tx.execute<{ name: string; key: string }>(
        sql`select name, key from spaces where id = ${spaceId} and quarantined for update`,
      );
      const current = space.rows[0];
      if (!current) throw new ImportError("importNotInReview", "The quarantine space is missing.");
      const target = { id: spaceId, organizationId: row.organization_id, ownerId: null, confidential: false };
      const grants = mergeGrants(
        [...input.grants],
        [{ principalKind: "account", principalId: row.importer_id, role: "admin" }],
      );
      for (const grant of grants) await this.#holders.validate(tx, target, grant, actor);
      await tx.execute(sql`delete from space_permissions where space_id = ${spaceId}`);
      await tx.execute(sql`
        update spaces set quarantined = false, visibility = ${input.visibility}, updated_at = now(),
          archived_at = ${row.archived ? sql`now()` : sql`null`}, archived_by = ${row.archived ? row.importer_id : null}
        where id = ${spaceId}`);
      const scope = auditScopeOf({ organizationId: row.organization_id });
      await this.#audit.record(tx, {
        name: "space.created",
        actor,
        targetId: spaceId,
        fields: {
          name: current.name,
          key: current.key,
          visibility: input.visibility,
          personal: false,
          ownerId: null,
        },
        scope,
      });
      await insertGrants(tx, this.#audit, actor, { ...target, name: current.name }, grants);
      if (row.archived) {
        await this.#audit.record(tx, {
          name: "space.archived",
          actor,
          targetId: spaceId,
          fields: { name: current.name },
          scope,
        });
      }
      await tx.execute(sql`
        update imports set state = 'accepted', decided_at = now(), decided_by = ${actorIdOf(actor)},
          file_expires_at = now() + make_interval(days => ${FILE_RETENTION_DAYS}), updated_at = now()
        where id = ${importId}`);
      await this.#releaseFile(tx, row);
      await tx.execute(sql`delete from import_records where import_id = ${importId}`);
      await this.resolution.markAccepted(tx, actor, {
        importId,
        organizationId: row.organization_id,
        spaceId,
        granted: grants,
      });
      await deleteCredentials(tx, this.#audit, {
        importId,
        organizationId: row.organization_id,
        reason: "accepted",
      });
      await this.#audit.record(tx, {
        name: "import.accepted",
        actor,
        targetId: importId,
        fields: { spaceId, spaceKey: current.key, archived: row.archived, grants: grants.length },
        scope: { type: "organization", id: row.organization_id },
      });
      await signalSpaceChange(tx, { spaceId, kind: "access", itemId: null });
      await signalSpaceChange(tx, { spaceId, kind: "space", itemId: null });
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    return this.get(actor, importId);
  }

  async #releaseFile(tx: Transaction, row: ImportRow): Promise<void> {
    if (!row.upload_id) return;
    await tx.execute(sql`
      update import_uploads set expires_at = now() + make_interval(days => ${FILE_RETENTION_DAYS}) where id = ${row.upload_id}`);
  }

  async takeOver(actor: Principal, importId: string): Promise<ImportView> {
    await this.#authorization.require(actor, "import.takeOver", { type: "import", id: importId });
    const actorId = actorIdOf(actor);
    if (!actorId) throw new ImportError("accountRequired", "Only people can import.");
    await this.#database.transaction(async (tx) => {
      const row = await this.#locked(tx, importId);
      if (row.state !== "held")
        throw new ImportError("importNotHeld", "The import is not waiting for an administrator.");
      await tx.execute(
        sql`delete from import_reviewers where import_id = ${importId} and account_id = ${actorId}`,
      );
      await tx.execute(sql`
        update imports set importer_id = ${actorId}, state = 'running', heartbeat_at = null, updated_at = now()
        where id = ${importId}`);
      if (row.quarantine_space_id) {
        const reviewers = (
          await tx.execute<{ account_id: string }>(
            sql`select account_id from import_reviewers where import_id = ${importId}`,
          )
        ).rows.map((reviewer) => reviewer.account_id);
        await setQuarantineReaders(tx, row.quarantine_space_id, actorId, [actorId, ...reviewers]);
      }
      await this.#audit.record(tx, {
        name: "import.takenOver",
        actor,
        targetId: importId,
        fields: { previousImporterId: row.importer_id },
        scope: { type: "organization", id: row.organization_id },
      });
      await signalImportChange(tx, { importId, organizationId: row.organization_id });
    });
    await this.#enqueue(importId);
    return this.get(actor, importId);
  }

  async #reportReadable(viewer: Principal, importId: string): Promise<ImportRow> {
    await this.#authorization.require(viewer, "import.view", { type: "import", id: importId });
    const row = await this.#row(this.#database, importId);
    if (!STARTED.includes(row.state) && row.state !== "accepted") {
      throw new ImportError("reportUnavailable", "The report is available once the import has started.");
    }
    return row;
  }

  async report(viewer: Principal, importId: string): Promise<ReportSummary> {
    await this.#reportReadable(viewer, importId);
    const result = await this.#database.execute<{ category: string; code: string; count: number }>(sql`
      select category, code, count(*)::int as count from import_problems where import_id = ${importId}
      group by category, code order by category, code`);
    const categories = result.rows
      .filter((row) => (reportCategoryNames as string[]).includes(row.category))
      .map((row) => ({ category: row.category as ReportCategory, code: row.code, count: row.count }));
    return {
      categories,
      total: categories.reduce((sum, row) => sum + row.count, 0),
      ...(await this.resolution.summary(this.#database, importId)),
    };
  }

  async entries(
    viewer: Principal,
    importId: string,
    filter: {
      category?: string | undefined;
      code?: string | undefined;
      macro?: string | undefined;
      after?: string | undefined;
      limit: number;
    },
  ): Promise<{ entries: ReportEntry[]; next: string | null }> {
    await this.#reportReadable(viewer, importId);
    const result = await this.#database.execute<{
      id: string;
      category: string;
      code: string;
      item_id: string | null;
      title: string | null;
      details: Record<string, unknown>;
    }>(sql`
      select p.id, p.category, p.code, p.item_id,
        case when ${visibleItem(this.#authorization, viewer, sql`t`, sql`s`)} then t.title end as title, p.details
      from import_problems p
      left join tree_items t on t.id = p.item_id
      left join spaces s on s.id = t.space_id
      where p.import_id = ${importId}
        ${filter.category ? sql`and p.category = ${filter.category}` : sql``}
        ${filter.code ? sql`and p.code = ${filter.code}` : sql``}
        ${filter.macro ? sql`and p.code = 'unsupportedMacro' and p.details ->> 'name' = ${filter.macro}` : sql``}
        ${filter.after ? sql`and p.id > ${filter.after}` : sql``}
      order by p.id limit ${filter.limit + 1}`);
    const rows = result.rows.slice(0, filter.limit);
    const entries: ReportEntry[] = rows.map((row) => ({
      id: row.id,
      category: row.category,
      code: row.code,
      item: row.item_id ? { id: row.item_id, title: row.title } : null,
      details: row.details,
    }));
    return { entries, next: result.rows.length > filter.limit ? (rows.at(-1)?.id ?? null) : null };
  }

  async macros(viewer: Principal, importId: string): Promise<MacroUsage[]> {
    await this.#reportReadable(viewer, importId);
    const result = await this.#database.execute<{ name: string; pages: number; occurrences: number }>(sql`
      select details ->> 'name' as name, count(distinct coalesce(item_id::text, source_id))::int as pages,
        coalesce(sum((details ->> 'count')::int), 0)::int as occurrences
      from import_problems where import_id = ${importId} and code = 'unsupportedMacro'
      group by details ->> 'name' order by pages desc, name limit 500`);
    return result.rows;
  }

  async *reportCsv(viewer: Principal, importId: string): AsyncGenerator<string> {
    await this.#reportReadable(viewer, importId);
    yield `${["category", "code", "page", "details"].map(spreadsheetCell).join(",")}\r\n`;
    let after: string | undefined;
    for (;;) {
      const page = await this.entries(viewer, importId, { after, limit: 500 });
      for (const entry of page.entries) {
        yield `${[entry.category, entry.code, entry.item?.title ?? "", JSON.stringify(entry.details)].map(spreadsheetCell).join(",")}\r\n`;
      }
      if (!page.next) return;
      after = page.next;
    }
  }

  async reviewerCandidates(actor: Principal, organizationId: string, query: string): Promise<ImportPerson[]> {
    await this.#authorization.require(actor, "organization.imports.manage", {
      type: "organization",
      id: organizationId,
    });
    const term = `%${query
      .trim()
      .toLowerCase()
      .replace(/[%_\\]/g, (character) => `\\${character}`)}%`;
    const result = await this.#database.execute<{ id: string; name: string }>(sql`
      select a.id, a.name from accounts a join memberships m on m.account_id = a.id
      where m.organization_id = ${organizationId} and m.kind = 'member' and a.type = 'standard'
        and a.state = 'active' and (m.expires_at is null or m.expires_at > now())
        and a.id <> ${actorIdOf(actor)}
        and (lower(a.name) like ${term} or lower(coalesce(a.email, '')) like ${term})
      order by lower(a.name), a.id limit 20`);
    return result.rows;
  }
}
