import {
  Badge,
  Button,
  Combobox,
  type ComboboxItem,
  ConfirmDialog,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Menu,
  Select,
  Table,
  TableToolbar,
  Tabs,
  TruncatedText,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  CalendarClock,
  Check,
  Info,
  MoreHorizontal,
  Plus,
  ShieldMinus,
  ShieldPlus,
  UserCog,
  UserMinus,
  UserX,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import {
  invitationsQuery,
  type Member,
  memberPermissionsQuery,
  membersQuery,
  organizationKeys,
  organizationQuery,
} from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { AppDatePicker } from "../../components/date-fields.js";
import { PersonAvatar } from "../../components/person-avatar.js";
import { memberLoader } from "../../components/pickers.js";
import { useUnassignWithUndo } from "../../components/role-undo.js";
import { usePaged, useSorted } from "../../components/table-state.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { InviteDialog } from "./invite-dialog.js";
import { AssignRoleDialog } from "./roles.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/members");

type Tab = "all" | "member" | "collaborator" | "guest" | "invitations";
type Action =
  | { kind: "roles"; member: Member }
  | { kind: "expiry"; member: Member }
  | { kind: "responsible"; member: Member }
  | { kind: "permissions"; member: Member }
  | { kind: "remove"; member: Member }
  | { kind: "deactivate"; member: Member }
  | { kind: "unassign"; member: Member; assignmentId: string; role: string };

const KIND_BADGES = { member: "neutral", collaborator: "info", guest: "warning" } as const;

export function MembersScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const format = useFormat();
  const organization = useQuery(organizationQuery(organizationId));
  const members = useQuery(membersQuery(organizationId));
  const manage = state.can("organization.members.manage");
  const invitations = useQuery({ ...invitationsQuery(organizationId), enabled: manage });
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [factorFilter, setFactorFilter] = useState<"all" | "on" | "off">("all");
  const [inviting, setInviting] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const organizationName = organization.data?.name ?? "";

  const people = (members.data ?? []).filter((member) => member.accountType !== "service");
  const counts = {
    all: people.length,
    member: people.filter((member) => member.kind === "member").length,
    collaborator: people.filter((member) => member.kind === "collaborator").length,
    guest: people.filter((member) => member.kind === "guest").length,
    invitations: invitations.data?.length ?? 0,
  };
  const needle = search.trim().toLowerCase();
  const roleName = (role: Member["roles"][number]) =>
    role.customRoleId ? role.role : translateKey(t, `roles.builtIn.${role.role}`);
  const groupOptions = [
    ...new Map(people.flatMap((member) => member.groups).map((group) => [group.id, group])),
  ]
    .map(([, group]) => group)
    .sort((left, right) => left.name.localeCompare(right.name));
  const roleOptions = [...new Set(people.flatMap((member) => member.roles.map(roleName)))].sort();
  const filtered = people.filter(
    (member) =>
      (tab === "all" || member.kind === tab) &&
      (groupFilter === "all" || member.groups.some((group) => group.id === groupFilter)) &&
      (roleFilter === "all" || member.roles.some((role) => roleName(role) === roleFilter)) &&
      (factorFilter === "all" || member.twoFactorActive === (factorFilter === "on")) &&
      (!needle ||
        member.name.toLowerCase().includes(needle) ||
        (member.email ?? "").toLowerCase().includes(needle)),
  );
  const sorted = useSorted(filtered, { key: "name", direction: "asc" }, (member, key) =>
    key === "lastActive"
      ? (member.lastActiveAt ?? "")
      : key === "kind"
        ? member.kind
        : member.name.toLowerCase(),
  );
  const paged = usePaged(sorted.rows);
  const filtersActive = groupFilter !== "all" || roleFilter !== "all" || factorFilter !== "all";
  const queryClient = useQueryClient();
  const unassign = useUnassignWithUndo({ organizationId }, async () => {
    await queryClient.invalidateQueries({ queryKey: organizationKeys.members(organizationId) });
    await queryClient.invalidateQueries({ queryKey: organizationKeys.assignments(organizationId) });
  });
  const nameOf = useMemo(() => new Map(people.map((member) => [member.accountId, member.name])), [people]);

  const memberMenu = (member: Member) => [
    {
      label: t("members.actions.roles"),
      icon: ShieldPlus,
      onSelect: () => setAction({ kind: "roles", member }),
      disabled: member.kind !== "member",
    },
    ...member.roles.map((role) => ({
      label: t("members.actions.removeRole", {
        role: role.customRoleId ? role.role : translateKey(t, `roles.builtIn.${role.role}`),
      }),
      icon: ShieldMinus,
      onSelect: () => {
        if (!role.customRoleId && role.role === "owner") {
          setAction({ kind: "unassign", member, assignmentId: role.assignmentId, role: role.role });
          return;
        }
        void unassign(
          {
            id: role.assignmentId,
            builtInRole: role.customRoleId ? null : role.role,
            customRoleId: role.customRoleId,
            principalKind: "account",
            principalId: member.accountId,
            expiresAt: role.expiresAt,
          },
          t("roles.unassignedNamed", {
            name: member.name,
            role: role.customRoleId ? role.role : translateKey(t, `roles.builtIn.${role.role}`),
          }),
        );
      },
    })),
    { type: "separator" as const },
    ...(member.kind !== "member"
      ? [
          {
            label: t("members.actions.expiry"),
            icon: CalendarClock,
            onSelect: () => setAction({ kind: "expiry", member }),
          },
        ]
      : []),
    ...(member.kind === "guest"
      ? [
          {
            label: t("members.actions.responsible"),
            icon: UserCog,
            onSelect: () => setAction({ kind: "responsible", member }),
          },
        ]
      : []),
    {
      label: t("members.actions.permissions"),
      icon: Info,
      onSelect: () => setAction({ kind: "permissions", member }),
    },
    { type: "separator" as const },
    {
      label: t("members.actions.remove"),
      icon: UserMinus,
      danger: true,
      onSelect: () => setAction({ kind: "remove", member }),
    },
    ...(state.can("instance.accounts.manage") || member.kind === "member" || member.accountType === "portal"
      ? [
          {
            label: t("members.actions.deactivate"),
            icon: UserX,
            danger: true,
            onSelect: () => setAction({ kind: "deactivate", member }),
          },
        ]
      : []),
  ];

  return (
    <SettingsPage
      wide
      title={t("members.title")}
      description={t("members.description", { name: organizationName })}
      actions={
        manage ? (
          <Button variant="primary" icon={Plus} onClick={() => setInviting(true)}>
            {t("members.invite")}
          </Button>
        ) : null
      }
    >
      <Tabs
        label={t("members.tabs")}
        value={tab}
        onValueChange={(value) => {
          setTab(value as Tab);
          paged.reset();
        }}
        tabs={[
          { value: "all", label: t("members.all"), count: counts.all },
          { value: "member", label: t("members.kindsPlural.member"), count: counts.member },
          { value: "collaborator", label: t("members.kindsPlural.collaborator"), count: counts.collaborator },
          { value: "guest", label: t("members.kindsPlural.guest"), count: counts.guest },
          ...(manage
            ? [{ value: "invitations", label: t("members.invitations"), count: counts.invitations }]
            : []),
        ]}
      >
        {tab === "invitations" ? (
          <InvitationsTable organizationId={organizationId} />
        ) : (
          <div className="flex flex-col gap-4">
            <TableToolbar
              search={{
                value: search,
                onChange: (value) => {
                  setSearch(value);
                  paged.reset();
                },
                label: t("members.search"),
                placeholder: t("members.search"),
              }}
              filters={
                <>
                  {groupOptions.length > 0 ? (
                    <Select
                      aria-label={t("members.filters.group")}
                      className="w-auto max-w-field"
                      value={groupFilter}
                      onValueChange={(value) => {
                        setGroupFilter(value);
                        paged.reset();
                      }}
                      options={[
                        { value: "all", label: t("members.filters.allGroups") },
                        ...groupOptions.map((group) => ({ value: group.id, label: group.name })),
                      ]}
                    />
                  ) : null}
                  <Select
                    aria-label={t("members.filters.role")}
                    className="w-auto max-w-field"
                    value={roleFilter}
                    onValueChange={(value) => {
                      setRoleFilter(value);
                      paged.reset();
                    }}
                    options={[
                      { value: "all", label: t("members.filters.allRoles") },
                      ...roleOptions.map((role) => ({ value: role, label: role })),
                    ]}
                  />
                  <Select
                    aria-label={t("members.twoFactor")}
                    className="w-auto max-w-field"
                    value={factorFilter}
                    onValueChange={(value) => {
                      setFactorFilter(value as "all" | "on" | "off");
                      paged.reset();
                    }}
                    options={[
                      { value: "all", label: t("members.filters.anyTwoFactor") },
                      { value: "on", label: t("members.filters.twoFactorOn") },
                      { value: "off", label: t("members.filters.twoFactorOff") },
                    ]}
                  />
                </>
              }
              filtersActive={filtersActive}
              onResetFilters={() => {
                setGroupFilter("all");
                setRoleFilter("all");
                setFactorFilter("all");
                paged.reset();
              }}
              pagination={paged.pagination}
            />
            <Table
              caption={t("members.title")}
              rowKey={(member) => member.accountId}
              rows={paged.rows}
              loading={members.isPending}
              onRowClick={(member) => setAction({ kind: "permissions", member })}
              rowLabel={(member) => t("members.openPermissions", { name: member.name })}
              sort={sorted.sort}
              onSortChange={sorted.setSort}
              pagination={paged.pagination}
              empty={
                <p className="p-4 text-text-muted">{needle ? t("members.noMatches") : t("members.none")}</p>
              }
              columns={[
                {
                  key: "name",
                  header: t("members.name"),
                  sortable: true,
                  cell: (member) => (
                    <div className="flex items-center gap-3">
                      <PersonAvatar
                        id={member.accountId}
                        name={member.name}
                        pictureRef={member.pictureRef}
                        size="sm"
                      />
                      <div className="flex min-w-0 flex-col leading-tight">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium" title={member.name}>
                            {member.name}
                          </span>
                          {member.kind === "member" ? null : (
                            <Badge variant={KIND_BADGES[member.kind]}>
                              {t(`members.kinds.${member.kind}`)}
                            </Badge>
                          )}
                        </span>
                        <span className="truncate text-xs text-text-muted" title={member.email ?? ""}>
                          {member.email}
                        </span>
                      </div>
                    </div>
                  ),
                },
                {
                  key: "groups",
                  header: t("members.groups"),
                  hideBelow: "md",
                  cell: (member) => {
                    const names = member.groups.map((group) => group.name).join(", ");
                    return names ? (
                      <TruncatedText text={names} className="max-w-field" />
                    ) : (
                      <span className="text-text-muted">{t("members.noGroups")}</span>
                    );
                  },
                },
                {
                  key: "roles",
                  header: t("members.role"),
                  hideBelow: "sm",
                  cell: (member) => {
                    const roles = member.roles.map(roleName).join(", ");
                    const expiry = member.expiresAt
                      ? t("members.until", { date: format.date(member.expiresAt) })
                      : null;
                    return (
                      <span className={roles ? undefined : "text-text-muted"}>
                        {[
                          roles || t(`members.kinds.${member.kind}`),
                          expiry,
                          member.responsibleAccountId
                            ? t("members.responsibleIs", {
                                name: nameOf.get(member.responsibleAccountId) ?? "",
                              })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    );
                  },
                },
                {
                  key: "twoFactor",
                  header: t("members.twoFactor"),
                  hideBelow: "md",
                  cell: (member) =>
                    member.twoFactorActive ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check aria-hidden="true" className="size-icon-sm" />
                        {t("common.yes")}
                      </span>
                    ) : (
                      <Badge variant="warning">{t("common.no")}</Badge>
                    ),
                },
                {
                  key: "lastActive",
                  header: t("members.lastActive"),
                  sortable: true,
                  hideBelow: "md",
                  cell: (member) => (
                    <span className="whitespace-nowrap text-text-muted">
                      {member.lastActiveAt ? format.relative(member.lastActiveAt) : t("members.never")}
                    </span>
                  ),
                },
                {
                  key: "actions",
                  sticky: true,
                  header: t("settings.actions"),
                  align: "end",
                  cell: (member) =>
                    manage ? (
                      <Menu
                        align="end"
                        trigger={
                          <IconButton
                            label={t("members.actionsFor", { name: member.name })}
                            icon={MoreHorizontal}
                          />
                        }
                        items={memberMenu(member)}
                      />
                    ) : null,
                },
              ]}
            />
            <p className="text-sm text-text-muted">{t("members.noLimit")}</p>
          </div>
        )}
      </Tabs>
      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        organizationId={organizationId}
        organizationName={organizationName}
      />
      {action?.kind === "roles" ? (
        <AssignRoleDialog
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          organizationId={organizationId}
          organizationName={organizationName}
          fixedPrincipal={{ kind: "account", id: action.member.accountId, name: action.member.name }}
        />
      ) : null}
      <MemberActionDialogs
        action={action}
        onClose={() => setAction(null)}
        organizationId={organizationId}
        organizationName={organizationName}
        people={people}
      />
    </SettingsPage>
  );
}

function MemberActionDialogs({
  action,
  onClose,
  organizationId,
  organizationName,
  people,
}: {
  action: Action | null;
  onClose: () => void;
  organizationId: string;
  organizationName: string;
  people: Member[];
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const session = useSession();
  const queryClient = useQueryClient();
  const [expiry, setExpiry] = useState("");
  const [expiryMissing, setExpiryMissing] = useState(false);
  const [responsible, setResponsible] = useState<ComboboxItem | null>(null);
  const responsibleLoader = useMemo(() => memberLoader(organizationId), [organizationId]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: organizationKeys.members(organizationId) });
  const run = async (call: () => Promise<unknown>, success: string) => {
    try {
      await call();
      await refresh();
      toast({ title: success, variant: "success" });
      onClose();
    } catch (failure) {
      showFailure(t("failures.changeMember"), failure);
    }
  };
  const close = (open: boolean) => {
    if (!open) onClose();
  };
  if (!action || action.kind === "roles") return null;
  const member = action.member;

  if (action.kind === "permissions")
    return <PermissionsDialog organizationId={organizationId} member={member} onClose={onClose} />;

  if (action.kind === "unassign") {
    return (
      <ConfirmDialog
        open
        onOpenChange={close}
        title={t("roles.removeOwnerTitle", { name: member.name })}
        description={t("roles.removeOwnerSummary", { name: member.name, organization: organizationName })}
        confirmLabel={t("roles.removeOwner")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() =>
          run(
            () =>
              request(() =>
                api.DELETE("/api/v1/organizations/{organizationId}/role-assignments/{assignmentId}", {
                  params: { path: { organizationId, assignmentId: action.assignmentId } },
                }),
              ),
            t("roles.unassigned"),
          )
        }
      >
        <AccessImpact
          change="loses"
          people={[member.name]}
          what={t("roles.losesWhat", { count: 1, role: action.role, name: organizationName })}
        />
      </ConfirmDialog>
    );
  }

  if (action.kind === "remove") {
    return (
      <ConfirmDialog
        open
        onOpenChange={close}
        title={t("members.removeTitle", { name: member.name })}
        description={t("members.removeDescription")}
        confirmLabel={t("members.actions.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() =>
          run(
            () =>
              request(() =>
                api.DELETE("/api/v1/organizations/{organizationId}/members/{accountId}", {
                  params: { path: { organizationId, accountId: member.accountId } },
                }),
              ),
            t("members.removed"),
          )
        }
      >
        <AccessImpact
          change="loses"
          people={[member.name]}
          what={t("members.removeImpact", { count: 1, name: organizationName })}
        />
      </ConfirmDialog>
    );
  }

  if (action.kind === "deactivate") {
    return (
      <ConfirmDialog
        open
        onOpenChange={close}
        title={t("members.deactivateTitle", { name: member.name })}
        description={t("members.deactivateDescription")}
        confirmLabel={t("members.actions.deactivate")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() =>
          run(
            () =>
              request(() =>
                api.POST("/api/v1/accounts/{accountId}/deactivate", {
                  params: { path: { accountId: member.accountId } },
                }),
              ),
            t("members.deactivated"),
          )
        }
      >
        <AccessImpact
          change="loses"
          people={[member.name]}
          what={t("members.deactivateImpact", { count: 1 })}
        />
      </ConfirmDialog>
    );
  }

  if (action.kind === "expiry") {
    return (
      <Dialog open onOpenChange={close} title={t("members.expiryTitle", { name: member.name })} size="sm">
        <div className="flex flex-col gap-4">
          <Field
            label={t("members.expires")}
            hint={t("members.expiryHint")}
            help={t("members.expiryHelp")}
            {...(expiryMissing && !expiry ? { error: t("members.chooseDate") } : {})}
          >
            <AppDatePicker value={expiry} clearable onValueChange={setExpiry} />
          </Field>
          {expiry ? (
            <AccessImpact
              change="loses"
              people={[member.name]}
              what={t("members.expiryImpact", { count: 1, name: organizationName, date: expiry })}
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                void run(
                  () =>
                    request(() =>
                      api.PATCH("/api/v1/organizations/{organizationId}/members/{accountId}", {
                        params: { path: { organizationId, accountId: member.accountId } },
                        body: { expiresAt: null },
                      }),
                    ),
                  t("common.saved"),
                )
              }
            >
              {t("members.noExpiry")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!expiry) {
                  setExpiryMissing(true);
                  focusFirstInvalidSoon();
                  return;
                }
                void run(
                  () =>
                    request(() =>
                      api.PATCH("/api/v1/organizations/{organizationId}/members/{accountId}", {
                        params: { path: { organizationId, accountId: member.accountId } },
                        body: { expiresAt: new Date(`${expiry}T23:59:59`).toISOString() },
                      }),
                    ),
                  t("common.saved"),
                );
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  const currentId = member.responsibleAccountId ?? session.account?.id ?? null;
  const current = people.find((entry) => entry.accountId === currentId);
  const chosen: ComboboxItem | null =
    responsible ?? (current ? { value: current.accountId, label: current.name } : null);
  return (
    <Dialog open onOpenChange={close} title={t("members.responsibleTitle", { name: member.name })} size="sm">
      <div className="flex flex-col gap-4">
        <Field label={t("members.responsible")} hint={t("members.responsibleHint")}>
          <Combobox
            aria-label={t("members.responsible")}
            value={chosen?.value ?? null}
            selectedItem={chosen}
            load={responsibleLoader}
            onValueChange={(_value, item) => setResponsible(item)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              void run(
                () =>
                  request(() =>
                    api.PATCH("/api/v1/organizations/{organizationId}/members/{accountId}", {
                      params: { path: { organizationId, accountId: member.accountId } },
                      body: {
                        responsibleAccountId: chosen?.value ?? null,
                      },
                    }),
                  ),
                t("common.saved"),
              )
            }
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function PermissionsDialog({
  organizationId,
  member,
  onClose,
}: {
  organizationId: string;
  member: Member;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const decisions = useQuery({
    ...memberPermissionsQuery(organizationId, member.accountId),
    throwOnError: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("members.permissionsTitle", { name: member.name })}
      description={t("members.permissionsDescription")}
      size="lg"
    >
      {decisions.isError ? (
        <LoadError
          what={t("failures.loadPermissions")}
          error={decisions.error}
          onRetry={() => decisions.refetch()}
        />
      ) : null}
      <Table
        caption={t("members.permissionsTitle", { name: member.name })}
        rowKey={(decision) => decision.action}
        rows={decisions.data ?? []}
        loading={decisions.isPending}
        columns={[
          {
            key: "action",
            header: t("members.permission"),
            cell: (decision) => translateKey(t, `actions.${decision.action.replaceAll(".", "_")}`),
          },
          {
            key: "allowed",
            header: t("members.allowed"),
            cell: (decision) =>
              decision.allowed ? (
                <Badge variant="success">{t("common.yes")}</Badge>
              ) : (
                <Badge variant="neutral">{t("common.no")}</Badge>
              ),
          },
          {
            key: "why",
            header: t("members.why"),
            grow: true,
            cell: (decision) =>
              decision.allowed
                ? decision.grants.map((grant) => grantText(t, grant)).join("; ")
                : decision.denials.map((denial) => translateKey(t, `denials.${denial}`)).join("; "),
          },
        ]}
      />
    </Dialog>
  );
}

function grantText(t: Parameters<typeof translateKey>[0], grant: unknown): string {
  if (typeof grant !== "object" || grant === null) return "";
  const value = grant as {
    kind?: string;
    role?: { builtIn?: string; name?: string };
    via?: { type?: string; name?: string };
    membershipKind?: string;
    rule?: string;
  };
  if (value.kind === "role") {
    const role = value.role?.builtIn
      ? translateKey(t, `roles.builtIn.${value.role.builtIn}`)
      : (value.role?.name ?? "");
    const via = value.via?.type
      ? translateKey(t, `grants.via.${value.via.type}`, { name: value.via.name ?? "" })
      : "";
    return via ? `${role} (${via})` : role;
  }
  if (value.kind === "membership")
    return translateKey(t, `grants.membership.${value.membershipKind ?? "member"}`);
  if (value.kind === "rule") return translateKey(t, `grants.rules.${value.rule ?? ""}`);
  return translateKey(t, "grants.system");
}

function InvitationsTable({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const invitations = useQuery(invitationsQuery(organizationId));
  const [revoking, setRevoking] = useState<{ id: string; email: string } | null>(null);
  return (
    <>
      <Table
        caption={t("members.invitations")}
        rowKey={(invitation) => invitation.id}
        rows={invitations.data ?? []}
        loading={invitations.isPending}
        empty={<p className="p-4 text-text-muted">{t("members.noInvitations")}</p>}
        columns={[
          { key: "email", header: t("auth.email"), cell: (invitation) => invitation.email },
          {
            key: "kind",
            header: t("members.kind"),
            cell: (invitation) => t(`members.kinds.${invitation.kind}`),
          },
          {
            key: "role",
            header: t("roles.role"),
            hideBelow: "md",
            cell: (invitation) => invitation.role ?? "—",
          },
          {
            key: "expires",
            header: t("members.invitationExpires"),
            hideBelow: "sm",
            cell: (invitation) => format.date(invitation.expiresAt),
          },
          {
            key: "actions",
            sticky: true,
            header: t("settings.actions"),
            align: "end",
            cell: (invitation) => (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setRevoking({ id: invitation.id, email: invitation.email })}
              >
                {t("members.revokeInvitation")}
              </Button>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        title={t("members.revokeInvitationTitle", { email: revoking?.email ?? "" })}
        description={t("members.revokeInvitationDescription")}
        confirmLabel={t("members.revokeInvitation")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!revoking) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/organizations/{organizationId}/invitations/{invitationId}", {
                params: { path: { organizationId, invitationId: revoking.id } },
              }),
            );
            setRevoking(null);
            await queryClient.invalidateQueries({ queryKey: organizationKeys.invitations(organizationId) });
          } catch (failure) {
            showFailure(t("failures.revokeInvitation"), failure);
          }
        }}
      />
    </>
  );
}
