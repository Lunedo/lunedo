import { type Areas, areasOf, type RoleScope, roleNameSchema } from "@lunedo/shared";
import {
  Button,
  ChoiceTable,
  ConfirmDialog,
  DangerAction,
  DangerZone,
  Dialog,
  Field,
  IconButton,
  Input,
  Menu,
  Notice,
  Section,
  Table,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import {
  assignmentsQuery,
  groupsQuery,
  membersQuery,
  organizationKeys,
  organizationQuery,
  rolesQuery,
} from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { useUnassignWithUndo } from "../../components/role-undo.js";
import { useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { AssignRoleDialog, areasDescription, roleName } from "./roles.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/roles");

type Assignment = Awaited<ReturnType<NonNullable<ReturnType<typeof assignmentsQuery>["queryFn"]>>>[number];
type CustomRole = Awaited<ReturnType<NonNullable<ReturnType<typeof rolesQuery>["queryFn"]>>>[number];

export function OrganizationRolesScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const format = useFormat();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const organization = useQuery(organizationQuery(organizationId));
  const roles = useQuery(rolesQuery(organizationId));
  const assignments = useQuery(assignmentsQuery(organizationId));
  const members = useQuery(membersQuery(organizationId));
  const groups = useQuery(groupsQuery(organizationId));
  const manage = state.can("organization.roles.manage");
  const [editing, setEditing] = useState<CustomRole | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomRole | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const organizationName = organization.data?.name ?? "";
  const refreshAssignments = async () => {
    await queryClient.invalidateQueries({ queryKey: organizationKeys.assignments(organizationId) });
    await queryClient.invalidateQueries({ queryKey: organizationKeys.members(organizationId) });
  };
  const unassign = useUnassignWithUndo({ organizationId }, refreshAssignments);
  const owners = (assignments.data ?? []).filter((assignment) => assignment.builtInRole === "owner");

  const principalName = (assignment: Assignment) => {
    if (assignment.principalKind === "organizationMembers") return t("roles.principals.organizationMembers");
    if (assignment.principalKind === "instanceUsers") return t("roles.principals.instanceUsers");
    if (assignment.principalKind === "group")
      return t("roles.groupNamed", {
        name: groups.data?.find((group) => group.id === assignment.principalId)?.name ?? "",
      });
    return (
      members.data?.find((member) => member.accountId === assignment.principalId)?.name ?? t("common.unknown")
    );
  };
  const holders = (assignment: Assignment): { people: string[]; everyone?: string } => {
    if (assignment.principalKind === "account") return { people: [principalName(assignment)] };
    if (assignment.principalKind === "group") return { people: [], everyone: principalName(assignment) };
    return { people: [], everyone: principalName(assignment) };
  };

  return (
    <SettingsPage
      width="wide"
      title={t("roles.title")}
      description={t("roles.description")}
      actions={
        manage ? (
          <Button variant="primary" icon={Plus} onClick={() => setAssigning(true)}>
            {t("roles.assign")}
          </Button>
        ) : null
      }
    >
      <Section title={t("roles.builtInTitle")}>
        <Table
          caption={t("roles.builtInTitle")}
          rowKey={(row) => row.key}
          rows={(["owner", "administrator", "member"] as const).map((key) => ({ key }))}
          columns={[
            {
              key: "name",
              header: t("roles.name"),
              cell: (row) => <span className="font-medium">{t(`roles.builtIn.${row.key}`)}</span>,
            },
            {
              key: "areas",
              header: t("roles.grants"),
              cell: (row) => t(`roles.builtInDescriptions.${row.key}`),
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
              cell: (role) => areasDescription(t, "organization", role.areas as Areas),
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
                      { label: t("common.edit"), onSelect: () => setEditing(role) },
                      { label: t("common.deleteRole"), danger: true, onSelect: () => setDeleting(role) },
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
          rows={assignments.data ?? []}
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
                manage && assignment.builtInRole !== "owner" ? (
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

      {manage && owners.length > 0 ? (
        <DangerZone title={t("common.dangerZone")}>
          {owners.map((assignment) => (
            <DangerAction
              key={assignment.id}
              title={t("roles.removeOwnerEntry", { name: principalName(assignment) })}
              description={t("roles.removeOwnerSummary", {
                name: principalName(assignment),
                organization: organizationName,
              })}
              action={
                <Button variant="danger" size="sm" onClick={() => setRemoving(assignment)}>
                  {t("roles.removeOwner")}
                </Button>
              }
            />
          ))}
        </DangerZone>
      ) : null}
      <AssignRoleDialog
        open={assigning}
        onOpenChange={setAssigning}
        organizationId={organizationId}
        organizationName={organizationName}
      />
      {editing ? (
        <RoleEditorDialog
          grantable={state.grantableAreas("organization")}
          scope="organization"
          existing={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (values) => {
            if (editing === "new") {
              await request(() =>
                api.POST("/api/v1/organizations/{organizationId}/roles", {
                  params: { path: { organizationId } },
                  body: values as never,
                }),
              );
            } else {
              await request(() =>
                api.PATCH("/api/v1/organizations/{organizationId}/roles/{roleId}", {
                  params: { path: { organizationId, roleId: editing.id } },
                  body: values as never,
                }),
              );
            }
            await queryClient.invalidateQueries({ queryKey: organizationKeys.roles(organizationId) });
            setEditing(null);
          }}
          impact={
            editing !== "new"
              ? (assignments.data ?? [])
                  .filter((assignment) => assignment.customRoleId === editing.id)
                  .map(principalName)
              : []
          }
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
              api.DELETE("/api/v1/organizations/{organizationId}/roles/{roleId}", {
                params: { path: { organizationId, roleId: deleting.id } },
              }),
            );
            setDeleting(null);
            await queryClient.invalidateQueries({ queryKey: organizationKeys.roles(organizationId) });
            await queryClient.invalidateQueries({ queryKey: organizationKeys.assignments(organizationId) });
          } catch (failure) {
            showFailure(t("failures.deleteRole"), failure);
          }
        }}
      >
        <AccessImpact
          change="loses"
          people={(assignments.data ?? [])
            .filter((assignment) => assignment.customRoleId === deleting?.id)
            .map(principalName)}
          what={t("roles.deleteImpact", { name: deleting?.name ?? "" })}
        />
      </ConfirmDialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("roles.removeOwnerTitle", { name: removing ? principalName(removing) : "" })}
        description={
          removing
            ? t("roles.removeOwnerSummary", { name: principalName(removing), organization: organizationName })
            : undefined
        }
        confirmLabel={t("roles.removeOwner")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/organizations/{organizationId}/role-assignments/{assignmentId}", {
                params: { path: { organizationId, assignmentId: removing.id } },
              }),
            );
            setRemoving(null);
            await refreshAssignments();
          } catch (failure) {
            showFailure(t("failures.unassignRole"), failure);
          }
        }}
      >
        {removing ? (
          <AccessImpact
            change="loses"
            {...holders(removing)}
            what={t("roles.losesWhat", {
              count: holders(removing).people.length,
              role: roleName(t, removing),
              name: organizationName,
            })}
          />
        ) : null}
      </ConfirmDialog>
    </SettingsPage>
  );
}

const roleForm = z.object({
  name: roleNameSchema,
  areas: z.record(z.string(), z.enum(["none", "view", "manage"])),
});

export function RoleEditorDialog({
  scope,
  existing,
  onClose,
  onSave,
  impact,
  grantable,
}: {
  scope: RoleScope;
  grantable: Areas;
  existing: { name: string; areas: Record<string, unknown> } | null;
  onClose: () => void;
  onSave: (values: { name: string; areas: Areas }) => Promise<void>;
  impact: string[];
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(roleForm, {
    defaultValues: {
      name: existing?.name ?? "",
      areas: Object.fromEntries(
        areasOf(scope).map((area) => [area, (existing?.areas[area] as string | undefined) ?? "none"]),
      ),
    } as z.input<typeof roleForm>,
  });
  const values = form.watch("areas");
  const submit = form.handleSubmit(async (input) => {
    setError(null);
    const areas = Object.fromEntries(
      Object.entries(input.areas).filter(([, level]) => level !== "none"),
    ) as Areas;
    try {
      await onSave({ name: input.name, areas });
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={existing ? t("roles.editRole", { name: existing.name }) : t("roles.createRole")}
      size="md"
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.saveRole")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("roles.name")} error={form.formState.errors.name?.message}>
          <Input autoFocus {...form.register("name")} />
        </Field>
        <ChoiceTable
          caption={t("roles.areas")}
          labelHeader={t("roles.areas")}
          choiceHeader={t("roles.access")}
          rows={areasOf(scope).map((area) => {
            const name = translateKey(t, `areas.${scope}.${area}`);
            const held = grantable[area];
            return {
              key: area,
              label: name,
              description: translateKey(t, `areas.descriptions.${scope}.${area}`),
              value: values?.[area] ?? "none",
              options: (["none", "view", "manage"] as const).map((level) => {
                const allowed =
                  level === "none" || held === "manage" || (level === "view" && held === "view");
                return {
                  value: level,
                  label: t(`areas.levels.${level}`),
                  ...(allowed
                    ? {}
                    : {
                        disabled: true,
                        disabledReason: held
                          ? t("roles.cannotGrantMore", { area: name, level: t(`areas.levels.${held}`) })
                          : t("roles.cannotGrant", { area: name }),
                      }),
                };
              }),
              onValueChange: (value: string) =>
                form.setValue(`areas.${area}`, value as "none", { shouldDirty: true }),
            };
          })}
        />
        {existing && impact.length > 0 ? (
          <AccessImpact change="gains" people={impact} what={t("roles.editImpact")} />
        ) : null}
        <p className="text-sm text-text-muted">{t("roles.noSelfExtension")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
