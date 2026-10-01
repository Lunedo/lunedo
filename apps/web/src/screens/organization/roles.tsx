import { type Areas, areasOf, type RoleScope } from "@pagehall/shared";
import { Button, Dialog, Field, Input, Notice, Select, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import {
  groupMembersQuery,
  groupsQuery,
  membersQuery,
  organizationKeys,
  rolesQuery,
} from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
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

export type Principal =
  | { kind: "account"; id: string }
  | { kind: "group"; id: string }
  | { kind: "organizationMembers" }
  | { kind: "instanceUsers" };

export function usePrincipalPeople(organizationId: string, principal: Principal | null) {
  const members = useQuery({ ...membersQuery(organizationId), enabled: principal !== null });
  const groupMembers = useQuery({
    ...groupMembersQuery(principal?.kind === "group" ? principal.id : ""),
    enabled: principal?.kind === "group",
  });
  if (!principal) return { people: [] as string[], everyone: undefined as string | undefined };
  if (principal.kind === "account") {
    const member = members.data?.find((entry) => entry.accountId === principal.id);
    return { people: member ? [member.name] : [], everyone: undefined };
  }
  if (principal.kind === "group")
    return { people: groupMembers.data?.map((entry) => entry.name) ?? [], everyone: undefined };
  return { people: [] as string[], everyone: principal.kind };
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
  const groups = useQuery({ ...groupsQuery(organizationId), enabled: open && !fixedPrincipal });
  const members = useQuery({ ...membersQuery(organizationId), enabled: open });
  const [role, setRole] = useState("builtIn:administrator");
  const [kind, setKind] = useState<Principal["kind"]>(fixedPrincipal ? "account" : "account");
  const [target, setTarget] = useState(fixedPrincipal?.id ?? "");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const principal: Principal | null =
    kind === "organizationMembers" || kind === "instanceUsers"
      ? { kind }
      : target
        ? { kind, id: target }
        : null;
  const impact = usePrincipalPeople(organizationId, open ? principal : null);
  const customRole = roles.data?.find((entry) => `custom:${entry.id}` === role);
  const builtIn = role.startsWith("builtIn:") ? role.slice("builtIn:".length) : null;
  const areas = customRole
    ? (customRole.areas as Areas)
    : builtIn
      ? (BUILT_IN_AREAS[builtIn]?.organization ?? {})
      : {};
  const roleLabel = customRole ? customRole.name : builtIn ? translateKey(t, `roles.builtIn.${builtIn}`) : "";

  const submit = async () => {
    if (!principal) {
      setError(t("roles.choosePrincipal"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/role-assignments", {
          params: { path: { organizationId } },
          body: {
            role: builtIn
              ? { builtIn: builtIn as "owner" | "administrator" }
              : { customRoleId: customRole?.id ?? "" },
            principal: principal as never,
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

  const everyone =
    impact.everyone === "organizationMembers"
      ? t("access.allMembers", {
          count: members.data?.filter((entry) => entry.kind === "member").length ?? 0,
          name: organizationName,
        })
      : impact.everyone === "instanceUsers"
        ? t("access.allInstanceUsers")
        : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={fixedPrincipal ? t("roles.assignTo", { name: fixedPrincipal.name }) : t("roles.assign")}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <Field label={t("roles.role")}>
          <Select
            value={role}
            onValueChange={setRole}
            options={[
              {
                value: "builtIn:administrator",
                label: t("roles.builtIn.administrator"),
                group: t("roles.builtInGroup"),
              },
              { value: "builtIn:owner", label: t("roles.builtIn.owner"), group: t("roles.builtInGroup") },
              ...(roles.data ?? []).map((entry) => ({
                value: `custom:${entry.id}`,
                label: entry.name,
                group: t("roles.customGroup"),
              })),
            ]}
          />
        </Field>
        {fixedPrincipal ? null : (
          <>
            <Field label={t("roles.principal")}>
              <Select
                value={kind}
                onValueChange={(value) => {
                  setKind(value as Principal["kind"]);
                  setTarget("");
                }}
                options={[
                  { value: "account", label: t("roles.principals.account") },
                  { value: "group", label: t("roles.principals.group") },
                  { value: "organizationMembers", label: t("roles.principals.organizationMembers") },
                  { value: "instanceUsers", label: t("roles.principals.instanceUsers") },
                ]}
              />
            </Field>
            {kind === "account" ? (
              <Field label={t("roles.person")}>
                <Select
                  value={target}
                  onValueChange={setTarget}
                  placeholder={t("roles.choosePerson")}
                  options={(members.data ?? [])
                    .filter((entry) => entry.kind === "member")
                    .map((entry) => ({
                      value: entry.accountId,
                      label: entry.email ? `${entry.name} (${entry.email})` : entry.name,
                    }))}
                />
              </Field>
            ) : null}
            {kind === "group" ? (
              <Field label={t("roles.group")}>
                <Select
                  value={target}
                  onValueChange={setTarget}
                  placeholder={t("roles.chooseGroup")}
                  options={(groups.data ?? []).map((entry) => ({ value: entry.id, label: entry.name }))}
                />
              </Field>
            ) : null}
          </>
        )}
        <Field label={t("roles.expires")} hint={t("roles.expiresHint")}>
          <Input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
        </Field>
        {principal ? (
          <AccessImpact
            change="gains"
            people={impact.people}
            {...(everyone ? { everyone } : {})}
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
          <Button variant="primary" loading={busy} disabled={!principal} onClick={() => void submit()}>
            {t("roles.assignAction")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
