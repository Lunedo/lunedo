import { groupDescriptionSchema, groupNameSchema } from "@pagehall/shared";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  List,
  ListRow,
  Notice,
  Section,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Plus, ShieldCheck, Trash2, UserMinus, UsersRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import {
  assignmentsQuery,
  groupMembersQuery,
  groupQuery,
  membersQuery,
  organizationKeys,
} from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { roleName } from "./roles.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/groups/$groupId");

const detailsForm = z.object({ name: groupNameSchema, description: groupDescriptionSchema });

type Pending =
  | { kind: "addMember" }
  | { kind: "addManager" }
  | { kind: "removeMember"; accountId: string; name: string }
  | { kind: "removeManager"; accountId: string; name: string }
  | { kind: "delete" };

export function GroupScreen() {
  const { t } = useTranslation();
  const { organizationId, groupId } = route.useParams();
  const state = useOrganizationState();
  const format = useFormat();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const group = useQuery({ ...groupQuery(groupId), throwOnError: false });
  const members = useQuery(groupMembersQuery(groupId));
  const assignments = useQuery({
    ...assignmentsQuery(organizationId),
    enabled: state.can("organization.roles.view"),
  });
  const [pending, setPending] = useState<Pending | null>(null);
  const accountId = state.session.account?.id;
  const isManager = group.data?.managers.some((manager) => manager.accountId === accountId) ?? false;
  const canManage = isManager || state.can("organization.members.manage");
  const groupRoles = (assignments.data ?? []).filter(
    (entry) => entry.principalKind === "group" && entry.principalId === groupId,
  );
  const roleSummary = groupRoles.map((entry) => roleName(t, entry)).join(", ");
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: organizationKeys.group(groupId) });
    await queryClient.invalidateQueries({ queryKey: organizationKeys.groupMembers(groupId) });
  };
  const run = async (call: () => Promise<unknown>, success: string) => {
    try {
      await call();
      await refresh();
      setPending(null);
      toast({ title: success, variant: "success" });
    } catch (failure) {
      showFailure(t("failures.changeGroup"), failure);
    }
  };

  if (group.isError)
    return <LoadError what={t("failures.loadGroup")} error={group.error} onRetry={() => group.refetch()} />;

  return (
    <SettingsPage
      title={group.data?.name ?? ""}
      description={group.data?.description || t("groups.noDescription")}
      icon={UsersRound}
      organizationId={organizationId}
      breadcrumbs={[
        { label: t("groups.title"), href: `/settings/organizations/${organizationId}/groups` },
        { label: group.data?.name ?? "" },
      ]}
      actions={
        canManage ? (
          <Button variant="danger" icon={Trash2} onClick={() => setPending({ kind: "delete" })}>
            {t("groups.delete")}
          </Button>
        ) : null
      }
    >
      {group.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {group.data && canManage ? <DetailsSection group={group.data} onSaved={refresh} /> : null}
      <Section title={t("groups.access")} icon={ShieldCheck}>
        {groupRoles.length === 0 ? (
          <p className="px-4 py-3 text-text-muted">{t("groups.noAccess")}</p>
        ) : (
          <List>
            {groupRoles.map((entry) => (
              <ListRow
                key={entry.id}
                icon={ShieldCheck}
                title={roleName(t, entry)}
                description={
                  entry.expiresAt
                    ? t("groups.roleExpires", { date: format.date(entry.expiresAt) })
                    : t("groups.roleInOrganization")
                }
              />
            ))}
          </List>
        )}
      </Section>
      <Section
        title={t("groups.managers")}
        actions={
          canManage ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => setPending({ kind: "addManager" })}
            >
              {t("groups.addManager")}
            </Button>
          ) : null
        }
      >
        <List>
          {group.data?.managers.map((manager) => (
            <ListRow
              key={manager.accountId}
              icon={UsersRound}
              title={manager.name}
              actions={
                canManage ? (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() =>
                      setPending({ kind: "removeManager", accountId: manager.accountId, name: manager.name })
                    }
                  >
                    {t("common.remove")}
                  </Button>
                ) : null
              }
            />
          ))}
        </List>
      </Section>
      <Section
        title={t("groups.members", { count: members.data?.length ?? 0 })}
        actions={
          canManage ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={() => setPending({ kind: "addMember" })}
            >
              {t("groups.addMember")}
            </Button>
          ) : null
        }
      >
        {members.isPending ? <Skeleton className="h-12 w-full" /> : null}
        {members.data?.length === 0 ? (
          <p className="px-4 py-3 text-text-muted">{t("groups.noMembers")}</p>
        ) : null}
        <ul className="flex flex-col">
          {members.data?.map((member) => (
            <li
              key={member.accountId}
              className="flex items-center gap-3 border-border border-b px-4 py-2 last:border-b-0"
            >
              <Avatar name={member.name} size="sm" />
              <span className="flex-1">{member.name}</span>
              {member.expiresAt ? (
                <Badge variant="warning">{t("groups.until", { date: format.date(member.expiresAt) })}</Badge>
              ) : null}
              {canManage ? (
                <Button
                  variant="danger"
                  size="sm"
                  icon={UserMinus}
                  onClick={() =>
                    setPending({ kind: "removeMember", accountId: member.accountId, name: member.name })
                  }
                >
                  {t("common.remove")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      {pending?.kind === "addMember" || pending?.kind === "addManager" ? (
        <AddPersonDialog
          organizationId={organizationId}
          manager={pending.kind === "addManager"}
          exclude={
            pending.kind === "addManager"
              ? (group.data?.managers.map((manager) => manager.accountId) ?? [])
              : (members.data?.map((member) => member.accountId) ?? [])
          }
          groupName={group.data?.name ?? ""}
          roleSummary={roleSummary}
          onClose={() => setPending(null)}
          onAdd={(person, expiry) =>
            run(
              () =>
                pending.kind === "addManager"
                  ? request(() =>
                      api.POST("/api/v1/groups/{groupId}/managers", {
                        params: { path: { groupId } },
                        body: { accountId: person },
                      }),
                    )
                  : request(() =>
                      api.POST("/api/v1/groups/{groupId}/members", {
                        params: { path: { groupId } },
                        body: {
                          accountId: person,
                          ...(expiry ? { expiresAt: new Date(`${expiry}T23:59:59`).toISOString() } : {}),
                        },
                      }),
                    ),
              pending.kind === "addManager" ? t("groups.managerAdded") : t("groups.memberAdded"),
            )
          }
        />
      ) : null}
      <ConfirmDialog
        open={pending?.kind === "removeMember" || pending?.kind === "removeManager"}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending?.kind === "removeManager"
            ? t("groups.removeManagerTitle", { name: pending.name })
            : t("groups.removeMemberTitle", { name: pending && "name" in pending ? pending.name : "" })
        }
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          if (pending?.kind === "removeMember")
            return run(
              () =>
                request(() =>
                  api.DELETE("/api/v1/groups/{groupId}/members/{accountId}", {
                    params: { path: { groupId, accountId: pending.accountId } },
                  }),
                ),
              t("groups.memberRemoved"),
            );
          if (pending?.kind === "removeManager")
            return run(
              () =>
                request(() =>
                  api.DELETE("/api/v1/groups/{groupId}/managers/{accountId}", {
                    params: { path: { groupId, accountId: pending.accountId } },
                  }),
                ),
              t("groups.managerRemoved"),
            );
          return undefined;
        }}
      >
        {pending?.kind === "removeMember" ? (
          <AccessImpact
            change="loses"
            people={[pending.name]}
            what={
              roleSummary
                ? t("groups.losesRoles", { roles: roleSummary, name: group.data?.name ?? "" })
                : t("groups.losesMembership", { name: group.data?.name ?? "" })
            }
          />
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={pending?.kind === "delete"}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={t("groups.deleteTitle", { name: group.data?.name ?? "" })}
        description={t("groups.deleteDescription")}
        confirmLabel={t("groups.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          try {
            await request(() => api.DELETE("/api/v1/groups/{groupId}", { params: { path: { groupId } } }));
            await queryClient.invalidateQueries({ queryKey: organizationKeys.groups(organizationId) });
            setPending(null);
            await navigate({
              to: "/settings/organizations/$organizationId/groups",
              params: { organizationId },
            });
          } catch (failure) {
            showFailure(t("failures.deleteGroup"), failure);
          }
        }}
      >
        <AccessImpact
          change="loses"
          people={members.data?.map((member) => member.name) ?? []}
          what={
            roleSummary
              ? t("groups.losesRoles", { roles: roleSummary, name: group.data?.name ?? "" })
              : t("groups.losesMembership", { name: group.data?.name ?? "" })
          }
        />
      </ConfirmDialog>
    </SettingsPage>
  );
}

function DetailsSection({
  group,
  onSaved,
}: {
  group: { id: string; name: string; description: string };
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(detailsForm, {
    defaultValues: { name: group.name, description: group.description },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() =>
        api.PATCH("/api/v1/groups/{groupId}", { params: { path: { groupId: group.id } }, body: values }),
      );
      await onSaved();
      form.reset(values);
      toast({ title: t("common.saved"), variant: "success" });
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  return (
    <Section title={t("groups.details")}>
      <form className="flex flex-col gap-4 p-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.saveGroup")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("groups.name")} error={form.formState.errors.name?.message}>
          <Input {...form.register("name")} />
        </Field>
        <Field label={t("groups.descriptionLabel")} error={form.formState.errors.description?.message}>
          <Textarea rows={2} {...form.register("description")} />
        </Field>
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            loading={form.formState.isSubmitting}
            disabled={!form.formState.isDirty}
          >
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function AddPersonDialog({
  organizationId,
  manager,
  exclude,
  groupName,
  roleSummary,
  onClose,
  onAdd,
}: {
  organizationId: string;
  manager: boolean;
  exclude: string[];
  groupName: string;
  roleSummary: string;
  onClose: () => void;
  onAdd: (accountId: string, expiry: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const members = useQuery(membersQuery(organizationId));
  const [person, setPerson] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const candidates = (members.data ?? []).filter(
    (member) => !exclude.includes(member.accountId) && member.accountType !== "service",
  );
  const name = candidates.find((member) => member.accountId === person)?.name;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={manager ? t("groups.addManager") : t("groups.addMember")}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <Field label={t("roles.person")}>
          <Select
            value={person}
            onValueChange={setPerson}
            placeholder={t("roles.choosePerson")}
            options={candidates.map((member) => ({
              value: member.accountId,
              label: member.email ? `${member.name} (${member.email})` : member.name,
            }))}
          />
        </Field>
        {manager ? null : (
          <Field label={t("groups.expires")} hint={t("roles.expiresHint")}>
            <Input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
          </Field>
        )}
        {name && !manager ? (
          <AccessImpact
            change="gains"
            people={[name]}
            what={
              roleSummary
                ? t("groups.gainsRoles", { roles: roleSummary, name: groupName })
                : t("groups.gainsMembership", { name: groupName })
            }
          />
        ) : null}
        {manager ? <Notice variant="info">{t("groups.managerHint")}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!person}
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onAdd(person, expiry).finally(() => setBusy(false));
            }}
          >
            {t("common.add")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
