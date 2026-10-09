import { Combobox, type ComboboxItem, Select } from "@pagehall/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import type { HolderKind, SpaceRole } from "../space-queries.js";

export const SPACE_ROLES: readonly SpaceRole[] = ["reader", "commenter", "editor", "admin"];

export interface Holder {
  principalKind: HolderKind;
  principalId: string | null;
}

export interface Grant extends Holder {
  role: SpaceRole;
  name?: string | null;
}

export function holderValue(holder: Holder): string {
  return holder.principalId ? `${holder.principalKind}:${holder.principalId}` : holder.principalKind;
}

export function parseHolderValue(value: string): Holder | null {
  if (value === "organizationMembers" || value === "instanceUsers") {
    return { principalKind: value, principalId: null };
  }
  const [kind, id] = value.split(":");
  if ((kind === "account" || kind === "group") && id) return { principalKind: kind, principalId: id };
  return null;
}

export function holderLabel(
  t: TFunction,
  holder: Holder & { name?: string | null },
  organizationName?: string | null,
): string {
  switch (holder.principalKind) {
    case "organizationMembers":
      return organizationName
        ? t("spaces.holders.organizationMembersOf", { organization: organizationName })
        : t("spaces.holders.organizationMembers");
    case "instanceUsers":
      return t("spaces.holders.instanceUsers");
    case "group":
      return holder.name
        ? t("spaces.holders.group", { name: holder.name })
        : t("spaces.holders.unknownGroup");
    case "account":
      return holder.name ?? t("spaces.holders.unknownPerson");
  }
}

export function roleLabel(t: TFunction, role: SpaceRole): string {
  return t(`spaces.roles.${role}`);
}

export function RoleSelect({
  value,
  onValueChange,
  label,
}: {
  value: SpaceRole;
  onValueChange: (role: SpaceRole) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <Select
      aria-label={label}
      value={value}
      onValueChange={(next) => onValueChange(next as SpaceRole)}
      options={SPACE_ROLES.map((role) => ({ value: role, label: roleLabel(t, role) }))}
    />
  );
}

export function HolderPicker({
  organizationId,
  organizationName,
  personal,
  exclude,
  value,
  onValueChange,
  label,
  groups: includeGroups = true,
  placeholder,
  invalid,
}: {
  organizationId: string | null;
  organizationName: string | null;
  personal: boolean;
  exclude: readonly string[];
  value: string | null;
  onValueChange: (holder: (Holder & { name: string }) | null) => void;
  label: string;
  groups?: boolean;
  placeholder?: string;
  invalid?: boolean;
}) {
  const { t } = useTranslation();
  const everyone: ComboboxItem[] = personal
    ? []
    : [
        {
          value: "organizationMembers",
          label: holderLabel(
            t,
            { principalKind: "organizationMembers", principalId: null },
            organizationName,
          ),
          group: t("spaces.holders.everyoneGroup"),
        },
        {
          value: "instanceUsers",
          label: t("spaces.holders.instanceUsers"),
          group: t("spaces.holders.everyoneGroup"),
        },
      ];
  const load = async (query: string) => {
    const people = await request(() =>
      api.GET("/api/v1/people", { params: { query: { limit: 20, ...(query ? { q: query } : {}) } } }),
    );
    const groups =
      organizationId && includeGroups
        ? await request(() =>
            api.GET("/api/v1/organizations/{organizationId}/groups", {
              params: { path: { organizationId }, query: { limit: 20, ...(query ? { q: query } : {}) } },
            }),
          ).catch(() => ({ items: [] }))
        : { items: [] };
    const term = query.trim().toLowerCase();
    const items: ComboboxItem[] = [
      ...everyone.filter((item) => item.label.toLowerCase().includes(term)),
      ...groups.items.map((group) => ({
        value: `group:${group.id}`,
        label: group.name,
        description: t("spaces.holders.groupDescription"),
        group: t("spaces.holders.groupsGroup"),
      })),
      ...people.items.map((person) => ({
        value: `account:${person.id}`,
        label: person.name,
        ...(person.email ? { description: person.email } : {}),
        group: t("spaces.holders.peopleGroup"),
      })),
    ];
    return { items: items.filter((item) => !exclude.includes(item.value)) };
  };
  return (
    <Combobox
      aria-label={label}
      placeholder={placeholder ?? t("spaces.holders.searchPlaceholder")}
      {...(invalid ? { invalid } : {})}
      emptyText={t("spaces.holders.noMatch")}
      value={value}
      load={load}
      onValueChange={(next, item) => {
        const holder = next ? parseHolderValue(next) : null;
        onValueChange(holder && item ? { ...holder, name: item.label } : null);
      }}
    />
  );
}
