import { groupDescriptionSchema, groupNameSchema } from "@lunedo/shared";
import {
  Avatar,
  Badge,
  Button,
  Combobox,
  type ComboboxItem,
  ConfirmDialog,
  DangerAction,
  DangerZone,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  List,
  ListRow,
  Notice,
  Section,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Plus, ShieldCheck, Trash2, UserMinus, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import {
  assignmentsQuery,
  groupMembersQuery,
  groupQuery,
  organizationKeys,
} from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { AutoSaveTextField } from "../../components/auto-save.js";
import { memberLoader } from "../../components/pickers.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { roleName } from "./roles.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/groups/$groupId");

type Pending = { kind: "addMember" } | { kind: "addManager" } | { kind: "delete" };

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
  const managedBy = group.data?.managedBy ?? null;
  const canManage = (isManager || state.can("organization.members.manage")) && managedBy === null;
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

  const addMember = (accountId: string, expiresAt: string | null) =>
    request(() =>
      api.POST("/api/v1/groups/{groupId}/members", {
        params: { path: { groupId } },
        body: { accountId, ...(expiresAt ? { expiresAt } : {}) },
      }),
    );
  const addManager = (accountId: string) =>
    request(() =>
      api.POST("/api/v1/groups/{groupId}/managers", { params: { path: { groupId } }, body: { accountId } }),
    );
  const undoable = async (remove: () => Promise<unknown>, title: string, restore: () => Promise<unknown>) => {
    try {
      await remove();
      await refresh();
    } catch (failure) {
      showFailure(t("failures.changeGroup"), failure);
      return;
    }
    toast({
      title,
      undo: {
        onUndo: () => {
          void restore()
            .then(refresh)
            .catch((failure: unknown) => showFailure(t("failures.changeGroup"), failure));
        },
      },
    });
  };
  const removeMember = (member: { accountId: string; name: string; expiresAt: string | null }) =>
    undoable(
      () =>
        request(() =>
          api.DELETE("/api/v1/groups/{groupId}/members/{accountId}", {
            params: { path: { groupId, accountId: member.accountId } },
          }),
        ),
      t("groups.memberRemovedName", { name: member.name }),
      () => addMember(member.accountId, member.expiresAt),
    );
  const removeManager = (manager: { accountId: string; name: string }) =>
    undoable(
      () =>
        request(() =>
          api.DELETE("/api/v1/groups/{groupId}/managers/{accountId}", {
            params: { path: { groupId, accountId: manager.accountId } },
          }),
        ),
      t("groups.managerRemovedName", { name: manager.name }),
      () => addManager(manager.accountId),
    );

  if (group.isError)
    return <LoadError what={t("failures.loadGroup")} error={group.error} onRetry={() => group.refetch()} />;

  return (
    <SettingsPage
      title={group.data?.name ?? ""}
      description={group.data?.description || t("groups.noDescription")}
      organizationId={organizationId}
      back={{ label: t("groups.title"), href: `/settings/organizations/${organizationId}/groups` }}
    >
      {group.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {managedBy ? (
        <Notice variant="info" title={t("groups.managedByTitle", { provider: managedBy.providerName })}>
          {t("groups.managedByDescription", { provider: managedBy.providerName })}
        </Notice>
      ) : null}
      {!managedBy && group.data?.formerlySynchronizedFrom ? (
        <Notice variant="info">
          {t("groups.formerlySynchronizedDescription", { provider: group.data.formerlySynchronizedFrom })}
        </Notice>
      ) : null}
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
                  <Button variant="danger" size="sm" onClick={() => void removeManager(manager)}>
                    {t("groups.removeManager")}
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
                <Button variant="danger" size="sm" icon={UserMinus} onClick={() => void removeMember(member)}>
                  {t("groups.removeMember")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
      {canManage ? (
        <DangerZone title={t("common.dangerZone")}>
          <DangerAction
            title={t("groups.delete")}
            description={t("groups.deleteSummary")}
            action={
              <Button variant="danger" size="sm" icon={Trash2} onClick={() => setPending({ kind: "delete" })}>
                {t("groups.delete")}
              </Button>
            }
          />
        </DangerZone>
      ) : null}
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
                  ? addManager(person)
                  : addMember(person, expiry ? new Date(`${expiry}T23:59:59`).toISOString() : null),
              pending.kind === "addManager" ? t("groups.managerAdded") : t("groups.memberAdded"),
            )
          }
        />
      ) : null}
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
        typedConfirmation={{
          value: group.data?.name ?? "",
          label: t("common.typeToConfirm", { name: group.data?.name ?? "" }),
          mismatch: t("common.nameMismatch"),
        }}
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
  const save = async (patch: { name: string } | { description: string }) => {
    await request(() =>
      api.PATCH("/api/v1/groups/{groupId}", { params: { path: { groupId: group.id } }, body: patch }),
    );
    await onSaved();
  };
  return (
    <Section title={t("groups.details")}>
      <div className="flex flex-col gap-4 p-4">
        <AutoSaveTextField
          label={t("groups.name")}
          value={group.name}
          schema={groupNameSchema}
          onSave={(name) => save({ name })}
        />
        <AutoSaveTextField
          label={t("groups.descriptionLabel")}
          value={group.description}
          schema={groupDescriptionSchema}
          multiline
          onSave={(description) => save({ description })}
        />
      </div>
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
  const excluded = exclude.join(",");
  const loader = useMemo(
    () => memberLoader(organizationId, { exclude: excluded.split(",") }),
    [organizationId, excluded],
  );
  const [selected, setSelected] = useState<ComboboxItem | null>(null);
  const person = selected?.value ?? "";
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const name = selected?.label;
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
        <Field
          label={t("roles.person")}
          {...(missing && !selected ? { error: t("roles.choosePeopleFirst") } : {})}
        >
          <Combobox
            placeholder={t("roles.choosePeople")}
            value={selected?.value ?? null}
            selectedItem={selected}
            load={loader}
            onValueChange={(_value, item) => setSelected(item)}
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
            loading={busy}
            onClick={() => {
              if (!person) {
                setMissing(true);
                focusFirstInvalidSoon();
                return;
              }
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
