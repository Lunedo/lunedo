import type { Areas } from "@lunedo/shared";
import {
  Button,
  Combobox,
  type ComboboxItem,
  ConfirmDialog,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Input,
  Menu,
  Notice,
  Section,
  Table,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import {
  type InstanceAccount,
  instanceAccountsQuery,
  instanceAssignmentsQuery,
  instanceKeys,
  instanceRolesQuery,
} from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { accountLoader } from "../../components/pickers.js";
import { useUnassignWithUndo } from "../../components/role-undo.js";
import { TransferOwnershipDialog } from "../../components/transfer-ownership-dialog.js";
import { useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { areasDescription, BUILT_IN_AREAS, roleName } from "../organization/roles.js";
import { RoleEditorDialog } from "../organization/roles-screen.js";
import { SettingsPage } from "../settings/settings-page.js";

type Assignment = Awaited<ReturnType<NonNullable<(typeof instanceAssignmentsQuery)["queryFn"]>>>[number];

export function withOwner(
  assignments: readonly Assignment[],
  accounts: readonly InstanceAccount[],
): Assignment[] {
  if (assignments.some((assignment) => assignment.builtInRole === "owner")) return [...assignments];
  const owner = accounts.find((account) =>
    account.instanceRoles.some((role) => role.builtInRole === "owner"),
  );
  if (!owner) return [...assignments];
  return [
    {
      id: `owner:${owner.id}`,
      scope: "instance",
      organizationId: null,
      role: "owner",
      builtInRole: "owner",
      customRoleId: null,
      principalKind: "account",
      principalId: owner.id,
      expiresAt: null,
    },
    ...assignments,
  ];
}
type CustomRole = Awaited<ReturnType<NonNullable<(typeof instanceRolesQuery)["queryFn"]>>>[number];

export function InstanceRolesScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const format = useFormat();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const roles = useQuery(instanceRolesQuery);
  const assignments = useQuery(instanceAssignmentsQuery);
  const accounts = useQuery(instanceAccountsQuery);
  const manage = state.can("instance.roles.manage");
  const [editing, setEditing] = useState<CustomRole | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomRole | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [transferring, setTransferring] = useState<string | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: instanceKeys.roles });
    await queryClient.invalidateQueries({ queryKey: instanceKeys.assignments });
  };
  const unassign = useUnassignWithUndo("instance", refresh);
  const principalName = (assignment: Assignment) =>
    assignment.principalKind === "instanceUsers"
      ? t("roles.principals.instanceUsers")
      : (accounts.data?.find((account) => account.id === assignment.principalId)?.name ??
        t("common.unknown"));

  return (
    <SettingsPage
      title={t("instance.roles.title")}
      description={t("instance.roles.description")}
      actions={
        manage ? (
          <Button variant="primary" icon={Plus} onClick={() => setAssigning(true)}>
            {t("roles.assign")}
          </Button>
        ) : null
      }
    >
      <Notice variant="info">{t("instance.roles.noContent")}</Notice>
      <Section title={t("roles.builtInTitle")}>
        <Table
          caption={t("roles.builtInTitle")}
          rowKey={(row) => row.key}
          rows={(["owner", "administrator", "securityAuditor"] as const).map((key) => ({ key }))}
          columns={[
            {
              key: "name",
              header: t("roles.name"),
              cell: (row) => <span className="font-medium">{t(`roles.builtIn.${row.key}`)}</span>,
            },
            {
              key: "grants",
              header: t("roles.grants"),
              cell: (row) => t(`roles.instanceDescriptions.${row.key}`),
            },
          ]}
        />
      </Section>
      <Section
        title={t("roles.customTitle")}
        actions={
          manage ? (
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setEditing("new")}>
              {t("roles.createRole")}
            </Button>
          ) : null
        }
      >
        <Table
          caption={t("roles.customTitle")}
          rowKey={(role) => role.id}
          rows={roles.data ?? []}
          loading={roles.isPending}
          empty={<p className="p-4 text-text-muted">{t("roles.noCustomRoles")}</p>}
          columns={[
            {
              key: "name",
              header: t("roles.name"),
              cell: (role) => <span className="font-medium">{role.name}</span>,
            },
            {
              key: "areas",
              header: t("roles.grants"),
              cell: (role) => areasDescription(t, "instance", role.areas as Areas),
            },
            {
              key: "actions",
              sticky: true,
              header: t("settings.actions"),
              align: "end",
              cell: (role) =>
                manage ? (
                  <Menu
                    align="end"
                    trigger={
                      <IconButton label={t("roles.actionsFor", { name: role.name })} icon={MoreHorizontal} />
                    }
                    items={[
                      { label: t("common.edit"), icon: Pencil, onSelect: () => setEditing(role) },
                      {
                        label: t("common.deleteRole"),
                        icon: Trash2,
                        danger: true,
                        onSelect: () => setDeleting(role),
                      },
                    ]}
                  />
                ) : null,
            },
          ]}
        />
      </Section>
      <Section title={t("roles.assignmentsTitle")}>
        <Table
          caption={t("roles.assignmentsTitle")}
          rowKey={(assignment) => assignment.id}
          rows={withOwner(assignments.data ?? [], accounts.data ?? []).sort(
            (left, right) => Number(right.builtInRole === "owner") - Number(left.builtInRole === "owner"),
          )}
          loading={assignments.isPending}
          empty={<p className="p-4 text-text-muted">{t("roles.noAssignments")}</p>}
          columns={[
            { key: "role", header: t("roles.role"), cell: (assignment) => roleName(t, assignment) },
            { key: "principal", header: t("roles.principal"), cell: principalName },
            {
              key: "expires",
              header: t("roles.expires"),
              hideBelow: "sm",
              cell: (assignment) =>
                assignment.expiresAt ? format.date(assignment.expiresAt) : t("members.noExpiry"),
            },
            {
              key: "actions",
              sticky: true,
              header: t("settings.actions"),
              align: "end",
              cell: (assignment) =>
                assignment.builtInRole === "owner" ? (
                  state.can("instance.ownership.transfer") ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setTransferring(assignment.principalId ?? "")}
                    >
                      {t("roles.transferOwnership")}
                    </Button>
                  ) : null
                ) : manage ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() =>
                      void unassign(
                        assignment,
                        t("roles.unassignedNamed", {
                          name: principalName(assignment),
                          role: roleName(t, assignment),
                        }),
                      )
                    }
                  >
                    {t("roles.unassign")}
                  </Button>
                ) : null,
            },
          ]}
        />
      </Section>
      {transferring !== null ? (
        <TransferOwnershipDialog ownerId={transferring} onClose={() => setTransferring(null)} />
      ) : null}
      {assigning ? (
        <AssignInstanceRoleDialog onClose={() => setAssigning(false)} roles={roles.data ?? []} />
      ) : null}
      {editing ? (
        <RoleEditorDialog
          grantable={state.grantableAreas("instance")}
          scope="instance"
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          impact={
            editing !== "new"
              ? (assignments.data ?? [])
                  .filter((entry) => entry.customRoleId === editing.id)
                  .map(principalName)
              : []
          }
          onSave={async (values) => {
            if (editing === "new")
              await request(() => api.POST("/api/v1/instance/roles", { body: values as never }));
            else
              await request(() =>
                api.PATCH("/api/v1/instance/roles/{roleId}", {
                  params: { path: { roleId: editing.id } },
                  body: values as never,
                }),
              );
            await refresh();
            setEditing(null);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={t("roles.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("roles.deleteDescription")}
        confirmLabel={t("common.deleteRole")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/instance/roles/{roleId}", { params: { path: { roleId: deleting.id } } }),
            );
            setDeleting(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.deleteRole"), failure);
          }
        }}
      >
        <AccessImpact
          change="loses"
          people={(assignments.data ?? [])
            .filter((entry) => entry.customRoleId === deleting?.id)
            .map(principalName)}
          what={t("roles.deleteImpact", { name: deleting?.name ?? "" })}
        />
      </ConfirmDialog>
    </SettingsPage>
  );
}

function AssignInstanceRoleDialog({ onClose, roles }: { onClose: () => void; roles: CustomRole[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<string | null>("builtIn:administrator");
  const [people, setPeople] = useState<ComboboxItem[]>([]);
  const loader = useMemo(() => accountLoader(), []);
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState({ role: false, people: false });
  const builtIn = role?.startsWith("builtIn:") ? role.slice(8) : null;
  const custom = roles.find((entry) => `custom:${entry.id}` === role);
  const areas = custom ? (custom.areas as Areas) : builtIn ? (BUILT_IN_AREAS[builtIn]?.instance ?? {}) : {};
  const label = custom ? custom.name : builtIn ? translateKey(t, `roles.builtIn.${builtIn}`) : "";

  const submit = async () => {
    if (people.length === 0 || !role) {
      setMissing({ role: !role, people: people.length === 0 });
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/instance/role-assignments/batch", {
          body: {
            role: builtIn
              ? { builtIn: builtIn as "administrator" | "securityAuditor" }
              : { customRoleId: custom?.id ?? "" },
            principals: people.map((item) => ({ kind: "account" as const, id: item.value })),
            ...(expiry ? { expiresAt: new Date(`${expiry}T23:59:59`).toISOString() } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: instanceKeys.assignments });
      onClose();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("roles.assign")}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <Notice variant="danger" title={t("failures.assignRole")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("roles.role")} {...(missing.role && !role ? { error: t("roles.chooseRole") } : {})}>
          <Combobox
            value={role}
            onValueChange={setRole}
            items={[
              {
                value: "builtIn:administrator",
                label: t("roles.builtIn.administrator"),
                group: t("roles.builtInGroup"),
              },
              {
                value: "builtIn:securityAuditor",
                label: t("roles.builtIn.securityAuditor"),
                group: t("roles.builtInGroup"),
              },
              ...roles.map((entry) => ({
                value: `custom:${entry.id}`,
                label: entry.name,
                group: t("roles.customGroup"),
              })),
            ]}
          />
        </Field>
        <Field
          label={t("roles.peopleLabel")}
          hint={t("roles.instancePrincipalsHint")}
          {...(missing.people && people.length === 0 ? { error: t("roles.choosePeopleFirst") } : {})}
        >
          <Combobox
            multiple
            placeholder={t("roles.choosePeople")}
            value={people.map((item) => item.value)}
            selectedItems={people}
            load={loader}
            onValueChange={(_values, items) => setPeople(items)}
          />
        </Field>
        <Field label={t("roles.expires")} hint={t("roles.expiresHint")}>
          <Input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
        </Field>
        <AccessImpact
          change="gains"
          people={people.map((item) => item.label)}
          what={t("instance.roles.gainsWhat", {
            count: people.length,
            role: label,
            areas: areasDescription(t, "instance", areas),
          })}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {t("roles.assignAction")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
