import { type Areas, areasOf, type RoleScope } from "@pagehall/shared";
import { Button, Combobox, type ComboboxItem, Dialog, Field, Input, Notice, useToast } from "@pagehall/ui";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { groupMembersQuery, organizationKeys, rolesQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { ACCOUNT_PREFIX, principalFromValue, principalLoader } from "../../components/pickers.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";

export const BUILT_IN_AREAS: Record<string, Record<RoleScope, Areas>> = {
  owner: {
    instance: Object.fromEntries(areasOf("instance").map((area) => [area, "manage"])),
    organization: Object.fromEntries(areasOf("organization").map((area) => [area, "manage"])),
  },
  administrator: {
    instance: Object.fromEntries(areasOf("instance").map((area) => [area, "manage"])),
    organization: Object.fromEntries(areasOf("organization").map((area) => [area, "manage"])),
  },
  securityAuditor: {
    instance: Object.fromEntries(areasOf("instance").map((area) => [area, "view"])),
    organization: {},
  },
  member: { instance: {}, organization: { membersAndGroups: "view" } },
};

export function roleName(t: TFunction, role: { builtInRole?: string | null; role: string }): string {
  return role.builtInRole ? translateKey(t, `roles.builtIn.${role.builtInRole}`) : role.role;
}

export function areasDescription(t: TFunction, scope: RoleScope, areas: Areas): string {
  const entries = Object.entries(areas);
  if (entries.length === 0) return t("roles.noAreas");
  return entries
    .map(
      ([area, level]) =>
        `${translateKey(t, `areas.${scope}.${area}`)} (${translateKey(t, `areas.levels.${String(level)}`)})`,
    )
    .join(", ");
}

export function useGainingPeople(principals: readonly ComboboxItem[]) {
  const groupIds = principals
    .map((item) => principalFromValue(item.value))
    .filter((principal) => principal.kind === "group")
    .map((principal) => principal.id);
  const groupMembers = useQueries({ queries: groupIds.map((groupId) => groupMembersQuery(groupId)) });
  const people = new Set<string>();
  for (const item of principals)
    if (principalFromValue(item.value).kind === "account") people.add(item.label);
  for (const query of groupMembers) for (const member of query.data ?? []) people.add(member.name);
  return [...people];
}

export function roleItems(t: TFunction, custom: readonly { id: string; name: string }[]): ComboboxItem[] {
  return [
    {
      value: "builtIn:administrator",
      label: t("roles.builtIn.administrator"),
      group: t("roles.builtInGroup"),
    },
    { value: "builtIn:owner", label: t("roles.builtIn.owner"), group: t("roles.builtInGroup") },
    ...custom.map((entry) => ({
      value: `custom:${entry.id}`,
      label: entry.name,
      group: t("roles.customGroup"),
    })),
  ];
}

export function AssignRoleDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
  fixedPrincipal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationName: string;
  fixedPrincipal?: { kind: "account"; id: string; name: string };
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const roles = useQuery({ ...rolesQuery(organizationId), enabled: open });
  const [role, setRole] = useState<string | null>("builtIn:administrator");
  const [principals, setPrincipals] = useState<ComboboxItem[]>(
    fixedPrincipal ? [{ value: `${ACCOUNT_PREFIX}${fixedPrincipal.id}`, label: fixedPrincipal.name }] : [],
  );
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loader = useMemo(() => principalLoader(organizationId, t), [organizationId, t]);
  const people = useGainingPeople(open ? principals : []);
  const customRole = roles.data?.find((entry) => `custom:${entry.id}` === role);
  const builtIn = role?.startsWith("builtIn:") ? role.slice("builtIn:".length) : null;
  const areas = customRole
    ? (customRole.areas as Areas)
    : builtIn
      ? (BUILT_IN_AREAS[builtIn]?.organization ?? {})
      : {};
  const roleLabel = customRole ? customRole.name : builtIn ? translateKey(t, `roles.builtIn.${builtIn}`) : "";

  const submit = async () => {
    if (principals.length === 0 || !role) {
      setError(t("roles.choosePrincipal"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/role-assignments/batch", {
          params: { path: { organizationId } },
          body: {
            role: builtIn
              ? { builtIn: builtIn as "owner" | "administrator" }
              : { customRoleId: customRole?.id ?? "" },
            principals: principals.map((item) => principalFromValue(item.value)),
            ...(expiry ? { expiresAt: new Date(`${expiry}T23:59:59`).toISOString() } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: organizationKeys.assignments(organizationId) });
      await queryClient.invalidateQueries({ queryKey: organizationKeys.members(organizationId) });
      toast({ title: t("roles.assigned"), variant: "success" });
      onOpenChange(false);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={fixedPrincipal ? t("roles.assignTo", { name: fixedPrincipal.name }) : t("roles.assign")}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <Notice variant="danger" title={t("failures.assignRole")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("roles.role")}>
          <Combobox
            aria-label={t("roles.role")}
            value={role}
            onValueChange={setRole}
            items={roleItems(t, roles.data ?? [])}
          />
        </Field>
        {fixedPrincipal ? null : (
          <Field label={t("roles.principalsLabel")} hint={t("roles.principalsHint")}>
            <Combobox
              multiple
              aria-label={t("roles.principalsLabel")}
              placeholder={t("roles.choosePrincipals")}
              value={principals.map((item) => item.value)}
              selectedItems={principals}
              load={loader}
              onValueChange={(_values, items) => setPrincipals(items)}
            />
          </Field>
        )}
        <Field label={t("roles.expires")} hint={t("roles.expiresHint")}>
          <Input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
        </Field>
        {principals.length > 0 ? (
          <AccessImpact
            change="gains"
            people={people}
            what={t("roles.gainsWhat", {
              role: roleLabel,
              areas: areasDescription(t, "organization", areas),
              name: organizationName,
            })}
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={principals.length === 0 || !role}
            onClick={() => void submit()}
          >
            {t("roles.assignAction")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
