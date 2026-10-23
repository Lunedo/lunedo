import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { accountNameSchema, jobTitleSchema } from "@lunedo/shared";
import { eq, sql } from "drizzle-orm";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Transaction } from "../database/database.js";
import type { FileService } from "../files/files.js";
import { LOGO_MAX_BYTES, logoContentType } from "../organizations/organizations.js";
import type { PeopleService } from "../spaces/people.js";
import type { StorageService } from "../storage/storage.js";
import { accountPictures } from "./picture-schema.js";
import { accountPrincipal, type Principal } from "./principal.js";
import { accounts } from "./schema.js";

export const PICTURE_MAX_BYTES = LOGO_MAX_BYTES;

export type ProfileErrorCode = "invalidPicture" | "nameFromProvider" | "accountNotFound";

export class ProfileError extends Error {
  override name = "ProfileError";

  constructor(
    readonly code: ProfileErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Profile {
  name: string;
  jobTitle: string | null;
  pictureRef: string | null;
  nameProvider: string | null;
}

export interface ProfileChange {
  name?: string;
  jobTitle?: string | null;
}

function cleanJobTitle(value: string | null): string | null {
  if (value === null) return null;
  const parsed = jobTitleSchema.parse(value);
  return parsed === "" ? null : parsed;
}

export class ProfileService {
  readonly #database: Database;
  readonly #files: FileService;
  readonly #audit: AuditLog;
  readonly #storage: StorageService | undefined;
  readonly #people: PeopleService;

  constructor(options: {
    database: Database;
    files: FileService;
    audit: AuditLog;
    people: PeopleService;
    storage?: StorageService;
  }) {
    this.#database = options.database;
    this.#files = options.files;
    this.#audit = options.audit;
    this.#storage = options.storage;
    this.#people = options.people;
  }

  async get(accountId: string): Promise<Profile> {
    const [row] = await this.#database
      .select({ name: accounts.name, jobTitle: accounts.jobTitle, pictureRef: accounts.pictureRef })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!row) throw new ProfileError("accountNotFound", "The account does not exist");
    return { ...row, nameProvider: await this.#nameProvider(this.#database, accountId) };
  }

  async #nameProvider(executor: Database | Transaction, accountId: string): Promise<string | null> {
    const result = await executor.execute<{ name: string }>(sql`
      select p.name from identities i join identity_providers p on p.id = i.provider_id
      where i.account_id = ${accountId} and i.display_name is not null and p.deactivated_at is null
        and p.config is not null
      order by i.last_sign_in_at desc nulls last, p.name
      limit 1`);
    return result.rows[0]?.name ?? null;
  }

  async update(accountId: string, change: ProfileChange): Promise<Profile> {
    const name = change.name === undefined ? undefined : accountNameSchema.parse(change.name);
    const jobTitle = change.jobTitle === undefined ? undefined : cleanJobTitle(change.jobTitle);
    await this.#database.transaction(async (tx) => {
      const [current] = await tx
        .select({ name: accounts.name, jobTitle: accounts.jobTitle })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (!current) throw new ProfileError("accountNotFound", "The account does not exist");
      const nameChanges = name !== undefined && name !== current.name;
      const jobTitleChanges = jobTitle !== undefined && jobTitle !== current.jobTitle;
      if (!nameChanges && !jobTitleChanges) return;
      if (nameChanges && (await this.#nameProvider(tx, accountId)) !== null) {
        throw new ProfileError("nameFromProvider", "The name comes from an identity provider");
      }
      const next = {
        name: nameChanges ? name : current.name,
        jobTitle: jobTitleChanges ? jobTitle : current.jobTitle,
      };
      await tx
        .update(accounts)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(accounts.id, accountId));
      await this.#audit.record(tx, {
        name: "account.profileChanged",
        actor: accountPrincipal(accountId),
        targetId: accountId,
        fields: {
          name: next.name,
          previousName: current.name,
          jobTitle: next.jobTitle,
          previousJobTitle: current.jobTitle,
        },
      });
    });
    return this.get(accountId);
  }

  async setPicture(accountId: string, picture: { contentType: string; data: Buffer }): Promise<Profile> {
    const contentType = logoContentType(picture.data);
    if (
      contentType === null ||
      contentType !== picture.contentType ||
      picture.data.length > PICTURE_MAX_BYTES
    ) {
      throw new ProfileError(
        "invalidPicture",
        "The picture must be a PNG, JPEG or WebP image of at most 256 KiB",
      );
    }
    await this.#storage?.requireUpload();
    const stored = await this.#files.write(Readable.from([picture.data]), {
      name: "picture",
      maxBytes: PICTURE_MAX_BYTES,
      stripLocation: true,
    });
    const ref = createHash("sha256").update(stored.id).digest("hex").slice(0, 16);
    try {
      await this.#database.transaction(async (tx) => {
        const [current] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, accountId))
          .for("update");
        if (!current) throw new ProfileError("accountNotFound", "The account does not exist");
        await this.#files.commit(tx, stored.id);
        await this.#releasePicture(tx, accountId);
        await tx.insert(accountPictures).values({ accountId, fileId: stored.id, contentType });
        await tx
          .update(accounts)
          .set({ pictureRef: ref, updatedAt: new Date() })
          .where(eq(accounts.id, accountId));
        await this.#audit.record(tx, {
          name: "account.pictureChanged",
          actor: accountPrincipal(accountId),
          targetId: accountId,
          fields: { removed: false },
        });
      });
    } catch (error) {
      await this.#database.execute(
        sql`update stored_files set state = 'orphaned', updated_at = now() where id = ${stored.id} and state = 'stored'`,
      );
      throw error;
    }
    return this.get(accountId);
  }

  async removePicture(accountId: string): Promise<Profile> {
    await this.#database.transaction(async (tx) => {
      const [current] = await tx
        .select({ pictureRef: accounts.pictureRef })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .for("update");
      if (!current) throw new ProfileError("accountNotFound", "The account does not exist");
      if (current.pictureRef === null) return;
      await this.#releasePicture(tx, accountId);
      await tx
        .update(accounts)
        .set({ pictureRef: null, updatedAt: new Date() })
        .where(eq(accounts.id, accountId));
      await this.#audit.record(tx, {
        name: "account.pictureChanged",
        actor: accountPrincipal(accountId),
        targetId: accountId,
        fields: { removed: true },
      });
    });
    return this.get(accountId);
  }

  async #releasePicture(tx: Transaction, accountId: string): Promise<void> {
    await tx.execute(sql`
      with released as (delete from account_pictures where account_id = ${accountId} returning file_id)
      update stored_files set state = 'orphaned', updated_at = now() where id in (select file_id from released)`);
  }

  async picture(
    viewer: Principal,
    accountId: string,
  ): Promise<{ contentType: string; data: Buffer; ref: string } | null> {
    const result = await this.#database.execute<{ file_id: string; content_type: string; ref: string }>(sql`
      select p.file_id, p.content_type, a.picture_ref as ref from account_pictures p
      join accounts a on a.id = p.account_id
      where p.account_id = ${accountId} and a.picture_ref is not null
        and ${this.#people.visibleCondition(viewer, sql`a.id`)}`);
    const row = result.rows[0];
    if (!row) return null;
    const data = await this.#files.readAll(row.file_id, PICTURE_MAX_BYTES);
    return { contentType: row.content_type, data, ref: row.ref };
  }
}
