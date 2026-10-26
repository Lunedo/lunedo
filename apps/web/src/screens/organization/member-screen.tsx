import {
  Badge,
  Button,
  IconButton,
  Menu,
  Table,
  Tabs,
  TruncatedText,
  useToast,
  VisuallyHidden,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { MoreHorizontal, Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import {
  type MemberDetails,
  memberDetailsQuery,
  membersQuery,
  organizationKeys,
  organizationQuery,
} from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AuditLog } from "../../components/audit-log.js";
import { PersonAvatar } from "../../components/person-avatar.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { SettingsPending } from "../settings/settings-pending.js";
import { AddGroupsDialog, AddSpacesDialog } from "./member-dialogs.js";
import { type MemberAction, MemberActionDialogs, PermissionsTable, useMemberMenu } from "./members-screen.js";
import { AssignRoleDialog } from "./roles.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/members/$accountId");

type Tab = "overview" | "groups" | "permissions" | "spaces" | "activity";

function Card({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        {count !== undefined ? <span className="font-normal text-text-muted">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-text-muted">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function MemberScreen() {
  const { t } = useTranslation();
  const { organizationId, accountId } = route.useParams();
  const state = useOrganizationState();
  const format = useFormat();
  const details = useQuery({ ...memberDetailsQuery(organizationId, accountId), throwOnError: false });
  const organization = useQuery(organizationQuery(organizationId));
  const members = useQuery(membersQuery(organizationId));
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const tab = (search.tab ?? "overview") as Tab;
  const setTab = (next: Tab) =>
    void navigate({
      to: ".",
      search: { tab: next === "overview" ? undefined : next },
      replace: true,
    });
  const [action, setAction] = useState<MemberAction | null>(null);
  const [adding, setAdding] = useState<"groups" | "spaces" | null>(null);
  const memberMenu = useMemberMenu(organizationId, setAction);
  const removeFromSpace = useRemoveFromSpace(organizationId, accountId);
  const membersHref = `/settings/organizations/${organizationId}/members`;
  if (details.isPending) return <SettingsPending />;
  if (details.isError) {
    return (
      <SettingsPage title={t("members.title")} back={{ label: t("members.title"), href: membersHref }} wide>
        <LoadError what={t("failures.loadMember")} error={details.error} onRetry={() => details.refetch()} />
      </SettingsPage>
    );
  }
  const member = details.data;
  const organizationName = organization.data?.name ?? "";
  const people = (members.data ?? []).filter((entry) => entry.accountType !== "service");
  const nameOf = (id: string | null) => people.find((entry) => entry.accountId === id)?.name ?? null;
  const roleNames = member.roles
    .map((role) => (role.customRoleId ? role.role : translateKey(t, `roles.builtIn.${role.role}`)))
    .join(", ");
  const canAudit = state.can("organization.audit.view");
  const tabs = [
    { value: "overview", label: t("members.page.overview") },
    { value: "groups", label: t("members.groups"), count: member.groupDetails.length },
    { value: "permissions", label: t("members.page.permissions") },
    ...(member.spaces
      ? [{ value: "spaces", label: t("members.page.spaces"), count: member.spaces.length }]
      : []),
    ...(canAudit ? [{ value: "activity", label: t("members.page.activity") }] : []),
  ];

  return (
    <SettingsPage
      wide
      title={member.name}
      back={{ label: t("members.title"), href: membersHref }}
      leading={
        <PersonAvatar id={member.accountId} name={member.name} pictureRef={member.pictureRef} size="lg" />
      }
      {...(member.kind === "member"
        ? {}
        : { status: <Badge variant="neutral">{t(`members.kinds.${member.kind}`)}</Badge> })}
      {...(member.email || member.jobTitle
        ? { description: [member.email, member.jobTitle].filter(Boolean).join(" · ") }
        : {})}
      actions={
        <div className="flex flex-wrap gap-2">
          {member.kind === "guest" ? (
            <Button variant="secondary" onClick={() => setAction({ kind: "expiry", member })}>
              {t("members.page.extend")}
            </Button>
          ) : null}
          <Menu
            align="end"
            trigger={
              <IconButton label={t("members.actionsFor", { name: member.name })} icon={MoreHorizontal} />
            }
            items={memberMenu(member, { permissions: false })}
          />
        </div>
      }
    >
      <Tabs
        label={t("members.page.tabs")}
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        tabs={tabs}
      >
        {tab === "overview" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title={t("members.page.membership")}>
              <Facts
                rows={[
                  [
                    t("members.role"),
                    <span key="role" className="flex flex-wrap items-baseline gap-2">
                      {roleNames || t(`members.kinds.${member.kind}`)}
                      {member.kind === "member" ? (
                        <button
                          type="button"
                          className="text-sm text-accent hover:underline focus-visible:focus-ring"
                          onClick={() => setAction({ kind: "roles", member })}
                        >
                          {t("members.page.change")}
                        </button>
                      ) : null}
                    </span>,
                  ],
                  [t("members.page.since"), format.date(member.joinedAt)],
                  ...(member.kind === "member"
                    ? []
                    : ([
                        [
                          t("members.page.accessUntil"),
                          member.expiresAt ? (
                            <span key="until" className="flex flex-wrap items-center gap-2">
                              {format.date(member.expiresAt)}
                              <Badge variant="warning">{format.distance(member.expiresAt)}</Badge>
                            </span>
                          ) : (
                            t("members.page.noEnd")
                          ),
                        ],
                      ] as [string, ReactNode][])),
                  ...(member.kind === "guest"
                    ? ([
                        [
                          t("members.responsible"),
                          nameOf(member.responsibleAccountId) ?? t("members.page.nobody"),
                        ],
                      ] as [string, ReactNode][])
                    : []),
                  [t("members.page.invitedBy"), member.invitedBy?.name ?? t("members.page.unknown")],
                ]}
              />
            </Card>
            <Card title={t("members.page.signIn")}>
              <Facts
                rows={[
                  [
                    t("members.twoFactor"),
                    <span key="factor" className="flex flex-wrap items-center gap-2">
                      {member.twoFactorActive ? t("common.yes") : t("common.no")}
                      <span className="text-text-muted">
                        {member.twoFactorRequired
                          ? t("members.page.factorRequired")
                          : t("members.page.factorNotRequired")}
                      </span>
                    </span>,
                  ],
                  [
                    t("members.page.signInWith"),
                    [
                      ...(member.signIn.password ? [t("members.page.password")] : []),
                      ...member.signIn.providers.map((provider) => provider.providerName),
                    ].join(", ") || t("members.page.unknown"),
                  ],
                  [
                    t("members.lastActive"),
                    member.lastActiveAt ? format.relative(member.lastActiveAt) : t("members.never"),
                  ],
                ]}
              />
              <p className="text-sm text-text-muted">{t("members.page.accountByInstance")}</p>
            </Card>
            <Card title={t("members.groups")} count={member.groupDetails.length}>
              {member.groupDetails.length === 0 ? (
                <p className="text-sm text-text-muted">{t("members.noGroups")}</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {member.groupDetails.map((group) => (
                    <li key={group.id}>
                      <Badge variant="neutral">{group.name}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={Plus}
                className="self-start"
                onClick={() => setAdding("groups")}
              >
                {t("members.page.addToGroups")}
              </Button>
            </Card>
            {member.spaces ? (
              <Card title={t("members.page.spaces")} count={member.spaces.length}>
                {member.spaces.length === 0 ? (
                  <p className="text-sm text-text-muted">{t("members.page.noSpaces")}</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {member.spaces.slice(0, 6).map((space) => (
                      <li key={space.id} className="truncate">
                        {space.name} · {translateKey(t, `spaces.roles.${space.role}`)}{" "}
                        <span className="text-text-muted">{sourceText(t, space.sources)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Plus}
                  className="self-start"
                  onClick={() => setAdding("spaces")}
                >
                  {t("members.page.addToSpaces")}
                </Button>
              </Card>
            ) : null}
          </div>
        ) : tab === "groups" ? (
          <GroupsTab member={member} organizationId={organizationId} onAdd={() => setAdding("groups")} />
        ) : tab === "permissions" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">{t("members.permissionsDescription")}</p>
            <PermissionsTable organizationId={organizationId} member={member} />
          </div>
        ) : tab === "spaces" && member.spaces ? (
          <div className="flex flex-col gap-3">
            <div className="flex justify-end">
              <Button variant="primary" size="sm" icon={Plus} onClick={() => setAdding("spaces")}>
                {t("members.page.addToSpaces")}
              </Button>
            </div>
            <Table
              caption={t("members.page.spaces")}
              rowKey={(space) => space.id}
              rows={member.spaces}
              empty={<p className="p-4 text-text-muted">{t("members.page.noSpaces")}</p>}
              columns={[
                {
                  key: "space",
                  header: t("members.page.space"),
                  grow: true,
                  cell: (space) => (
                    <Link
                      to="/spaces/$spaceKey"
                      params={{ spaceKey: space.key }}
                      className="font-medium hover:underline focus-visible:focus-ring"
                    >
                      {space.name}
                    </Link>
                  ),
                },
                {
                  key: "role",
                  header: t("members.role"),
                  cell: (space) => translateKey(t, `spaces.roles.${space.role}`),
                },
                {
                  key: "source",
                  header: t("members.page.source"),
                  cell: (space) => (
                    <TruncatedText
                      text={sourceText(t, space.sources)}
                      className="max-w-field text-text-muted"
                    />
                  ),
                },
                {
                  key: "remove",
                  header: <VisuallyHidden>{t("members.page.removeFromSpaceColumn")}</VisuallyHidden>,
                  cell: (space) =>
                    space.sources.some((source) => source.kind === "direct") && space.role !== "admin" ? (
                      <Button variant="secondary" size="sm" onClick={() => void removeFromSpace(space)}>
                        {t("members.page.removeFromSpace")}
                      </Button>
                    ) : null,
                },
              ]}
            />
            <p className="text-sm text-text-muted">{t("members.page.protectedSpaces")}</p>
          </div>
        ) : tab === "activity" && canAudit ? (
          <div className="flex flex-col gap-3">
            <AuditLog
              scope="organization"
              organizationId={organizationId}
              personId={member.accountId}
              canExport={false}
            />
            <p className="text-sm text-text-muted">{t("members.page.activityHint")}</p>
          </div>
        ) : null}
      </Tabs>
      {action?.kind === "roles" ? (
        <AssignRoleDialog
          open
          onOpenChange={(open) => {
            if (!open) setAction(null);
          }}
          organizationId={organizationId}
          organizationName={organizationName}
          fixedPrincipal={{ kind: "account", id: member.accountId, name: member.name }}
        />
      ) : null}
      <MemberActionDialogs
        action={action}
        onClose={() => setAction(null)}
        organizationId={organizationId}
        organizationName={organizationName}
        people={people}
      />
      <AddGroupsDialog
        open={adding === "groups"}
        onOpenChange={(open) => setAdding(open ? "groups" : null)}
        organizationId={organizationId}
        member={member}
      />
      {member.spaces ? (
        <AddSpacesDialog
          open={adding === "spaces"}
          onOpenChange={(open) => setAdding(open ? "spaces" : null)}
          organizationId={organizationId}
          member={member}
        />
      ) : null}
    </SettingsPage>
  );
}

type MemberSpace = NonNullable<MemberDetails["spaces"]>[number];

function useRemoveFromSpace(organizationId: string, accountId: string) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationKeys.member(organizationId, accountId) }),
      queryClient.invalidateQueries({ queryKey: organizationKeys.members(organizationId) }),
    ]);
  const path = { organizationId, accountId };
  return async (space: MemberSpace) => {
    try {
      const removed = await request(() =>
        api.DELETE("/api/v1/organizations/{organizationId}/members/{accountId}/spaces/{spaceId}", {
          params: { path: { ...path, spaceId: space.id } },
        }),
      );
      await refresh();
      toast({
        title: t("members.page.removedFromSpace", { space: space.name }),
        undo: {
          onUndo: () => {
            request(() =>
              api.POST("/api/v1/organizations/{organizationId}/members/{accountId}/spaces", {
                params: { path },
                body: { spaces: [{ spaceId: removed.spaceId, role: removed.role }] },
              }),
            ).then(
              () => refresh(),
              (failure: unknown) =>
                toast({
                  variant: "error",
                  title: t("members.page.undoRemoveFailed", { space: space.name }),
                  description: problemMessage(t, failure),
                }),
            );
          },
        },
      });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("members.page.removeFromSpaceFailed", { space: space.name }),
        description: problemMessage(t, failure),
      });
    }
  };
}

export function sourceText(t: Parameters<typeof translateKey>[0], sources: MemberSpace["sources"]): string {
  return sources
    .map((source) =>
      source.kind === "group"
        ? t("members.page.viaGroup", { name: source.groupName ?? "" })
        : source.kind === "direct"
          ? t("members.page.direct")
          : t("members.page.allMembers"),
    )
    .join(", ");
}

function GroupsTab({
  member,
  organizationId,
  onAdd,
}: {
  member: MemberDetails;
  organizationId: string;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const state = useOrganizationState();
  const refresh = () => queryClient.invalidateQueries({ queryKey: organizationKeys.members(organizationId) });
  const remove = async (group: MemberDetails["groupDetails"][number]) => {
    try {
      await request(() =>
        api.DELETE("/api/v1/groups/{groupId}/members/{accountId}", {
          params: { path: { groupId: group.id, accountId: member.accountId } },
        }),
      );
      await refresh();
      toast({
        title: t("members.page.removedFromGroup", { name: member.name, group: group.name }),
        undo: {
          onUndo: () =>
            void request(() =>
              api.POST("/api/v1/groups/{groupId}/members", {
                params: { path: { groupId: group.id } },
                body: { accountId: member.accountId },
              }),
            )
              .then(refresh)
              .catch((failure: unknown) => showFailure(t("failures.changeGroup"), failure)),
        },
      });
    } catch (failure) {
      showFailure(t("failures.changeGroup"), failure);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button variant="primary" size="sm" icon={Plus} onClick={onAdd}>
          {t("members.page.addToGroups")}
        </Button>
      </div>
      <Table
        caption={t("members.groups")}
        rowKey={(group) => group.id}
        rows={member.groupDetails}
        empty={<p className="p-4 text-text-muted">{t("members.noGroups")}</p>}
        columns={[
          {
            key: "name",
            header: t("groups.name"),
            grow: true,
            cell: (group) => {
              const provider = group.managedBy ?? group.viaProvider;
              return (
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      to="/settings/organizations/$organizationId/groups/$groupId"
                      params={{ organizationId, groupId: group.id }}
                      className="font-medium hover:underline focus-visible:focus-ring"
                    >
                      {group.name}
                    </Link>
                    {provider ? (
                      <Badge variant="info">
                        {t("members.page.viaProvider", { provider: provider.providerName })}
                      </Badge>
                    ) : null}
                  </span>
                  {provider ? (
                    <span className="text-sm whitespace-normal text-text-muted">
                      {t("members.page.providerKeeps", { provider: provider.providerName })}
                    </span>
                  ) : null}
                </span>
              );
            },
          },
          {
            key: "spaces",
            header: t("members.page.spaceAccess"),
            hideBelow: "sm",
            cell: (group) => (
              <TruncatedText
                text={
                  group.spaces > 0
                    ? t("members.page.givesSpaces", { count: group.spaces })
                    : t("members.page.noSpaceRoles")
                }
                className="max-w-field text-text-muted"
              />
            ),
          },
          {
            key: "actions",
            header: t("settings.actions"),
            align: "end",
            sticky: true,
            cell: (group) => (
              <Button
                variant="ghost"
                size="sm"
                disabled={Boolean(group.managedBy ?? group.viaProvider)}
                onClick={() => void remove(group)}
                aria-label={t("members.page.removeFromGroup", { group: group.name })}
              >
                {t("members.page.remove")}
              </Button>
            ),
          },
        ]}
      />
      {state.can("instance.signIn.view") &&
      member.groupDetails.some((group) => group.managedBy || group.viaProvider) ? (
        <p className="text-sm text-text-muted">{t("members.page.providerRules")}</p>
      ) : null}
    </div>
  );
}
