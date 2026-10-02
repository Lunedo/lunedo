import { emailSchema, idSchema } from "@pagehall/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor } from "../database/database.js";
import { OrganizationError } from "../organizations/organizations.js";
import { defineSetting } from "../settings/definition.js";
import type { SettingsService } from "../settings/service.js";

export const EMERGENCY_RECIPIENTS_ACTION = "instance.emergencyRecipients.manage";

export const emergencyRecipientsSetting = defineSetting({
  key: "auth.emergencySignInRecipients",
  schema: z
    .object({
      instanceAdministrators: z.boolean(),
      accounts: z.array(idSchema).max(50),
      addresses: z.array(emailSchema).max(20),
    })
    .strict(),
  default: { instanceAdministrators: true, accounts: [], addresses: [] },
  levels: ["instance"],
  lockable: false,
});

export interface EmergencyRecipients {
  instanceAdministrators: boolean;
  accounts: { id: string; name: string; email: string | null }[];
  addresses: string[];
}

export async function instanceAdministratorIds(executor: Executor): Promise<string[]> {
  const result = await executor.execute<{ id: string }>(sql`
    select distinct a.id from role_assignments ra join accounts a on a.id = ra.principal_id
    where ra.scope = 'instance' and ra.principal_kind = 'account'
      and ra.built_in_role in ('owner', 'administrator') and a.state = 'active'
      and (ra.expires_at is null or ra.expires_at > now())
    union select owner_account_id from instance where owner_account_id is not null`);
  return result.rows.map((row) => row.id);
}

export async function emergencyRecipientsOf(
  executor: Executor,
  settings: SettingsService,
): Promise<{ accountIds: string[]; addresses: string[] }> {
  const setting = await settings.get(emergencyRecipientsSetting, {}, { executor });
  const administrators = setting.instanceAdministrators ? await instanceAdministratorIds(executor) : [];
  const owner = await executor.execute<{ id: string }>(
    sql`select owner_account_id as id from instance where owner_account_id is not null`,
  );
  const chosen =
    setting.accounts.length === 0
      ? []
      : await executor
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(inArray(accounts.id, setting.accounts), eq(accounts.state, "active")));
  const accountIds = new Set([...administrators, ...[...owner.rows, ...chosen].map((row) => row.id)]);
  return { accountIds: [...accountIds], addresses: setting.addresses };
}

export class EmergencyRecipientsService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #authorization: AuthorizationService;

  constructor(options: {
    database: Database;
    settings: SettingsService;
    authorization: AuthorizationService;
  }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#authorization = options.authorization;
  }

  async get(): Promise<EmergencyRecipients> {
    const setting = await this.#settings.get(emergencyRecipientsSetting, {});
    const chosen =
      setting.accounts.length === 0
        ? []
        : await this.#database
            .select({ id: accounts.id, name: accounts.name, email: accounts.email })
            .from(accounts)
            .where(inArray(accounts.id, setting.accounts));
    return {
      instanceAdministrators: setting.instanceAdministrators,
      accounts: setting.accounts.flatMap((id) => chosen.filter((account) => account.id === id)),
      addresses: setting.addresses,
    };
  }

  async set(
    actor: Principal,
    input: { instanceAdministrators: boolean; accountIds: string[]; addresses: string[] },
  ): Promise<EmergencyRecipients> {
    await this.#database.transaction(async (tx) => {
      await this.#authorization.require(
        actor,
        EMERGENCY_RECIPIENTS_ACTION,
        { type: "instance" },
        { executor: tx },
      );
      const accountIds = [...new Set(input.accountIds)];
      const found =
        accountIds.length === 0
          ? []
          : await tx
              .select({ id: accounts.id })
              .from(accounts)
              .where(and(inArray(accounts.id, accountIds), eq(accounts.state, "active")));
      const missing = accountIds.filter((id) => !found.some((account) => account.id === id));
      if (missing.length > 0) {
        throw new OrganizationError("invalidInput", "Every recipient must be an active account", {
          fields: ["accountIds"],
        });
      }
      const parsed = emergencyRecipientsSetting.schema.safeParse({
        instanceAdministrators: input.instanceAdministrators,
        accounts: accountIds,
        addresses: [...new Set(input.addresses.map((address) => address.trim().toLowerCase()))],
      });
      if (!parsed.success) {
        throw new OrganizationError("invalidInput", "The recipients are not valid", {
          fields: parsed.error.issues.map((issue) => String(issue.path[0] ?? "")),
        });
      }
      await this.#settings.set(emergencyRecipientsSetting, {}, "instance", parsed.data, { tx });
    });
    return this.get();
  }
}
