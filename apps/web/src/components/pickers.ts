import type { ComboboxItem, ComboboxLoader, ComboboxPage } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { supportedLanguages } from "../i18n/index.js";
import { languageLabel } from "../settings/locale-options.js";

const LIMIT = 20;

function query(search: string, cursor: string | null) {
  return { limit: LIMIT, ...(search.trim() ? { q: search.trim() } : {}), ...(cursor ? { cursor } : {}) };
}

export function accountLoader(options: { exclude?: readonly string[] } = {}): ComboboxLoader {
  return async (search, cursor) => {
    const page = await request(() =>
      api.GET("/api/v1/instance/accounts", { params: { query: query(search, cursor) } }),
    );
    return {
      items: page.items
        .filter((account) => account.type !== "service" && !options.exclude?.includes(account.id))
        .map((account) => ({ value: account.id, label: account.name, description: account.email ?? "" })),
      nextCursor: page.nextCursor,
    };
  };
}

export function memberLoader(
  organizationId: string,
  options: { exclude?: readonly string[] } = {},
): ComboboxLoader {
  return async (search, cursor) => {
    const page = await request(() =>
      api.GET("/api/v1/organizations/{organizationId}/members", {
        params: { path: { organizationId }, query: query(search, cursor) },
      }),
    );
    return {
      items: page.items
        .filter((member) => !options.exclude?.includes(member.accountId))
        .map((member) => ({ value: member.accountId, label: member.name, description: member.email ?? "" })),
      nextCursor: page.nextCursor,
    };
  };
}

export function groupLoader(organizationId: string): ComboboxLoader {
  return async (search, cursor) => {
    const page = await request(() =>
      api.GET("/api/v1/organizations/{organizationId}/groups", {
        params: { path: { organizationId }, query: query(search, cursor) },
      }),
    );
    return {
      items: page.items.map((group) => ({
        value: group.id,
        label: group.name,
        description: group.description ?? "",
      })),
      nextCursor: page.nextCursor,
    };
  };
}

export const GROUP_PREFIX = "group:";
export const ACCOUNT_PREFIX = "account:";

interface PrincipalCursor {
  members: string | null;
  groups: string | null;
}

export function principalLoader(organizationId: string, t: TFunction): ComboboxLoader {
  return async (search, cursor): Promise<ComboboxPage> => {
    const state: PrincipalCursor = cursor
      ? (JSON.parse(cursor) as PrincipalCursor)
      : { members: null, groups: null };
    const first = cursor === null;
    const [members, groups] = await Promise.all([
      first || state.members
        ? request(() =>
            api.GET("/api/v1/organizations/{organizationId}/members", {
              params: { path: { organizationId }, query: query(search, state.members) },
            }),
          )
        : null,
      first || state.groups
        ? request(() =>
            api.GET("/api/v1/organizations/{organizationId}/groups", {
              params: { path: { organizationId }, query: query(search, state.groups) },
            }),
          )
        : null,
    ]);
    const items: ComboboxItem[] = [
      ...(members?.items ?? [])
        .filter((member) => member.accountType !== "service")
        .map((member) => ({
          value: `${ACCOUNT_PREFIX}${member.accountId}`,
          label: member.name,
          description: member.email ?? "",
          group: t("roles.people"),
        })),
      ...(groups?.items ?? []).map((group) => ({
        value: `${GROUP_PREFIX}${group.id}`,
        label: group.name,
        description: group.description ?? "",
        group: t("roles.groups"),
      })),
    ];
    const next: PrincipalCursor = {
      members: members?.nextCursor ?? null,
      groups: groups?.nextCursor ?? null,
    };
    return { items, nextCursor: next.members || next.groups ? JSON.stringify(next) : null };
  };
}

export function principalFromValue(value: string): { kind: "account" | "group"; id: string } {
  return value.startsWith(GROUP_PREFIX)
    ? { kind: "group", id: value.slice(GROUP_PREFIX.length) }
    : { kind: "account", id: value.replace(ACCOUNT_PREFIX, "") };
}

export function languageItems(t: TFunction, defaultLanguage?: string): ComboboxItem[] {
  return supportedLanguages.map((language) => ({
    value: language,
    label: languageLabel(t, language),
    ...(language === defaultLanguage ? { marker: t("ui.defaultMarker") } : {}),
  }));
}

export function knowledgeBaseLoader(organizationId: string): ComboboxLoader {
  return async (search, cursor) => {
    const page = await request(() =>
      api.GET("/api/v1/spaces", {
        params: { query: { ...query(search, cursor), organizationId, type: "knowledgeBase" } },
      }),
    );
    return {
      items: page.items.map((space) => ({ value: space.id, label: space.name, description: space.key })),
      nextCursor: page.nextCursor,
    };
  };
}
