import {
  Badge,
  Button,
  ConfirmDialog,
  DangerAction,
  DangerZone,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Notice,
  Section,
  Select,
  Skeleton,
  Table,
  TableToolbar,
  Tabs,
  Textarea,
  Tooltip,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { Info, UserPlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceKeys, instanceOrganizationsQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { AuditLog } from "../../components/audit-log.js";
import { formerUser } from "../../components/audit-presentation.js";
import { AccountIdentities } from "../../components/linked-identities.js";
import { PersonAvatar } from "../../components/person-avatar.js";
import { useServerTable } from "../../components/table-state.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { PersonalSpaceReview } from "../../spaces/settings/personal-space-review.js";
import { SettingsPage } from "../settings/settings-page.js";
import {
  AnonymizeDialog,
  HomeMark,
  HomeOrganizationChange,
  MergePlaceholder,
  PlaceholderDialog,
} from "./account-lifecycle.js";

const STATE_BADGES = {
  active: "success",
  invited: "info",
  deactivated: "neutral",
  anonymized: "neutral",
  placeholder: "neutral",
} as const;

type AccountPage = Awaited<ReturnType<typeof fetchAccounts>>;
type Account = AccountPage["items"][number];

const STATE_FILTERS = ["active", "deactivated", "placeholder", "anonymized"] as const;

type AccountFilter = "all" | "withoutOrganization" | "personalSpaceReview" | (typeof STATE_FILTERS)[number];

function fetchAccounts(
  search: string,
  cursor: string | null,
  filter: Exclude<AccountFilter, "personalSpaceReview"> = "all",
  limit = 25,
) {
  return request(() =>
    api.GET("/api/v1/instance/accounts", {
      params: {
        query: {
          limit,
          ...(search ? { q: search } : {}),
          ...(cursor ? { cursor } : {}),
          ...(filter === "withoutOrganization" ? { withoutOrganization: "true" as const } : {}),
          ...(filter !== "all" && filter !== "withoutOrganization" ? { state: filter } : {}),
        },
      },
    }),
  );
}

function accountName(t: TFunction, account: { id: string; name: string; state: string }): string {
  return account.state === "anonymized" ? formerUser(t, account.id) : account.name;
}

export function instanceRoleName(t: TFunction, role: { builtInRole: string | null; name?: string | null }) {
  return role.builtInRole ? translateKey(t, `roles.builtIn.${role.builtInRole}`) : (role.name ?? "");
}

export function InstanceAccountsScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const [filter, setFilter] = useState<AccountFilter>("all");
  const table = useServerTable([...instanceKeys.accounts, filter], (search, cursor, limit) =>
    fetchAccounts(search, cursor, filter === "personalSpaceReview" ? "all" : filter, limit),
  );
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const state = useOrganizationState();
  const manage = state.can("instance.accounts.manage");
  const reviewing = filter === "personalSpaceReview";

  return (
    <SettingsPage wide title={t("instance.accounts.title")} description={t("instance.accounts.description")}>
      <TableToolbar
        search={{ ...table.search, label: t("members.search"), placeholder: t("members.search") }}
        pagination={table.pagination}
        filters={
          <div className="w-field max-w-full">
            <Select
              aria-label={t("instance.accounts.filter")}
              value={filter}
              onValueChange={(value) => setFilter(value as AccountFilter)}
              options={[
                { value: "all", label: t("instance.accounts.filterAll") },
                { value: "withoutOrganization", label: t("instance.accounts.withoutOrganization") },
                ...STATE_FILTERS.map((accountState) => ({
                  value: accountState,
                  label: t(`instance.accounts.states.${accountState}`),
                })),
                ...(state.can("instance.personalSpaces.view")
                  ? [{ value: "personalSpaceReview", label: t("instance.accounts.personalSpaceReview") }]
                  : []),
              ]}
            />
          </div>
        }
        filtersActive={filter !== "all"}
        onResetFilters={() => setFilter("all")}
        {...(manage
          ? {
              actions: (
                <Button variant="secondary" icon={UserPlus} onClick={() => setCreating(true)}>
                  {t("lifecycle.placeholder.add")}
                </Button>
              ),
            }
          : {})}
      />
      {creating ? (
        <PlaceholderDialog
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false);
            await queryClient.invalidateQueries({ queryKey: instanceKeys.accounts });
          }}
        />
      ) : null}
      {reviewing ? (
        <PersonalSpaceReview />
      ) : table.query.isError ? (
        <LoadError
          what={t("failures.loadAccounts")}
          error={table.query.error}
          onRetry={() => table.query.refetch()}
        />
      ) : (
        <Table
          caption={t("instance.accounts.title")}
          rowKey={(account) => account.id}
          rows={table.rows}
          loading={table.query.isPending}
          pagination={table.pagination}
          onRowClick={(account) =>
            void navigate({ to: "/settings/instance/accounts/$accountId", params: { accountId: account.id } })
          }
          rowLabel={(account) => t("instance.accounts.open", { name: account.name })}
          empty={<p className="p-4 text-text-muted">{t("instance.accounts.empty")}</p>}
          columns={[
            {
              key: "name",
              header: t("members.name"),
              cell: (account) => (
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{accountName(t, account)}</span>
                  <span className="text-sm text-text-muted">{account.email ?? "—"}</span>
                </div>
              ),
            },
            {
              key: "type",
              header: (
                <span className="inline-flex items-center gap-1">
                  {t("instance.accounts.accountType")}
                  <IconButton size="sm" icon={Info} label={t("instance.accounts.typesHint")} />
                </span>
              ),
              cell: (account) => t(`instance.accounts.types.${account.type}`),
            },
            {
              key: "organizations",
              header: t("instance.accounts.organizations"),
              cell: (account) => <AccountOrganizations organizations={account.organizations} />,
            },
            {
              key: "role",
              header: t("instance.accounts.instanceRole"),
              hideBelow: "md",
              cell: (account) =>
                account.instanceRoles.length > 0
                  ? account.instanceRoles.map((role) => instanceRoleName(t, role)).join(", ")
                  : "—",
            },
            {
              key: "twoFactor",
              header: t("instance.accounts.twoFactor"),
              cell: (account) =>
                !canHaveSecondFactor(account) ? (
                  "—"
                ) : account.twoFactorActive ? (
                  <Badge variant="success">{t("instance.accounts.twoFactorOn")}</Badge>
                ) : (
                  <Badge variant="warning">{t("instance.accounts.twoFactorOff")}</Badge>
                ),
            },
            {
              key: "state",
              header: t("instance.accounts.state"),
              cell: (account) => (
                <Badge variant={STATE_BADGES[account.state]}>
                  {t(`instance.accounts.states.${account.state}`)}
                </Badge>
              ),
            },
            {
              key: "lastSignIn",
              header: t("instance.accounts.lastSignIn"),
              hideBelow: "md",
              cell: (account) =>
                account.lastSignInAt ? (
                  <Tooltip content={format.dateTime(account.lastSignInAt)}>
                    <span className="whitespace-nowrap">{format.date(account.lastSignInAt)}</span>
                  </Tooltip>
                ) : (
                  t("instance.accounts.never")
                ),
            },
            {
              key: "created",
              header: t("instance.accounts.created"),
              hideBelow: "md",
              cell: (account) => <span className="whitespace-nowrap">{format.date(account.createdAt)}</span>,
            },
          ]}
        />
      )}
    </SettingsPage>
  );
}

function AccountOrganizations({ organizations }: { organizations: Account["organizations"] }) {
  const { t } = useTranslation();
  if (organizations.length === 0) {
    return <Badge variant="warning">{t("instance.accounts.withoutOrganization")}</Badge>;
  }
  return (
    <ul className="flex min-w-0 flex-col gap-0.5">
      {organizations.map((organization) => (
        <li key={organization.id} className="flex min-w-0 items-center gap-1.5">
          {organization.home ? <HomeMark /> : null}
          <span className="break-words">{organization.name}</span>
        </li>
      ))}
    </ul>
  );
}

type PanelAction = "deactivate" | "reactivate" | "endSessions" | "reset" | "anonymize";

const accountRoute = getRouteApi("/app/settings/instance/accounts/$accountId");

function fetchAccount(accountId: string) {
  return request(() => api.GET("/api/v1/instance/accounts/{accountId}", { params: { path: { accountId } } }));
}

type AccountDetail = Awaited<ReturnType<typeof fetchAccount>>;

export function InstanceAccountScreen() {
  const { t } = useTranslation();
  const { accountId } = accountRoute.useParams();
  const navigate = useNavigate();
  const detail = useQuery({
    queryKey: [...instanceKeys.accounts, "detail", accountId],
    queryFn: () => fetchAccount(accountId),
    throwOnError: false,
  });
  const back = { label: t("instance.accounts.title"), href: "/settings/instance/accounts" };
  if (!detail.data) {
    return (
      <SettingsPage title={detail.isError ? t("instance.accounts.account") : ""} back={back}>
        {detail.isError ? (
          <LoadError what={t("failures.loadAccount")} error={detail.error} onRetry={() => detail.refetch()} />
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
      </SettingsPage>
    );
  }
  return (
    <SettingsPage title={accountName(t, detail.data.account)} back={back} wide>
      <AccountDetails
        detail={detail.data}
        onRefetch={async () => {
          await detail.refetch();
        }}
        onGone={() => void navigate({ to: "/settings/instance/accounts" })}
      />
    </SettingsPage>
  );
}

type AccountTab = "overview" | "security" | "organizations" | "tokens" | "activity";

function AccountCard({
  title,
  count,
  wide = false,
  children,
}: {
  title: string;
  count?: number;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-3 rounded-lg border border-border p-4 ${wide ? "lg:col-span-2" : ""}`}
    >
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        {count !== undefined ? <span className="font-normal text-text-muted">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function AccountFacts({ rows }: { rows: [string, ReactNode][] }) {
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

function AccountDetails({
  detail,
  onRefetch,
  onGone,
}: {
  detail: AccountDetail;
  onRefetch: () => Promise<void>;
  onGone: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const session = useSession();
  const state = useOrganizationState();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const { toast } = useToast();
  const [tab, setTab] = useState<AccountTab>("overview");
  const [action, setAction] = useState<PanelAction | null>(null);
  const [ending, setEnding] = useState<AccountDetail["sessions"][number] | null>(null);
  const account = detail.account;
  const own = account.id === session.account?.id;
  const manage = state.can("instance.accounts.manage");
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: instanceKeys.accounts });
  };
  const device = (entry: AccountDetail["sessions"][number]) =>
    [entry.browser, entry.operatingSystem].filter(Boolean).join(" · ") ||
    t("instance.accounts.unknownBrowser");

  const run = async (kind: Exclude<PanelAction, "reset" | "anonymize">) => {
    const accountId = account.id;
    try {
      if (kind === "deactivate")
        await request(() =>
          api.POST("/api/v1/accounts/{accountId}/deactivate", { params: { path: { accountId } } }),
        );
      if (kind === "reactivate")
        await request(() =>
          api.POST("/api/v1/accounts/{accountId}/reactivate", { params: { path: { accountId } } }),
        );
      if (kind === "endSessions") {
        const result = await request(() =>
          api.POST("/api/v1/accounts/{accountId}/sessions/end", { params: { path: { accountId } } }),
        );
        toast({
          title: t("instance.accounts.sessionsEnded", { count: result.endedSessions, name: account.name }),
          variant: "success",
        });
      }
      setAction(null);
      await refresh();
    } catch (failure) {
      showFailure(t("failures.changeAccount"), failure);
    }
  };

  const endSession = async (entry: AccountDetail["sessions"][number]) => {
    try {
      await request(() =>
        api.POST("/api/v1/accounts/{accountId}/sessions/{sessionId}/end", {
          params: { path: { accountId: account.id, sessionId: entry.id } },
        }),
      );
      toast({ title: t("instance.accounts.sessionEnded", { device: device(entry) }), variant: "success" });
      setEnding(null);
      await refresh();
    } catch (failure) {
      showFailure(t("failures.changeAccount"), failure, () => void endSession(entry));
    }
  };

  const dangerButton = (kind: PanelAction, label: string) => (
    <Button variant="danger" size="sm" onClick={() => setAction(kind)}>
      {label}
    </Button>
  );
  const anonymizable =
    account.state !== "anonymized" && (account.type === "standard" || account.type === "guest");
  const secondFactor = canHaveSecondFactor({ type: account.type, state: account.state });
  const tabs = [
    { value: "overview", label: t("instance.accounts.page.overview") },
    { value: "security", label: t("instance.accounts.page.security") },
    { value: "organizations", label: t("instance.accounts.organizations"), count: detail.memberships.length },
    { value: "tokens", label: t("instance.accounts.tokens"), count: detail.tokens.length },
    ...(state.can("instance.audit.view")
      ? [{ value: "activity", label: t("instance.accounts.page.activity") }]
      : []),
  ];

  return (
    <>
      <div className="flex min-w-0 items-center gap-4">
        <PersonAvatar id={account.id} name={account.name} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{t(`instance.accounts.types.${account.type}`)}</Badge>
            <span className="truncate text-text-muted" title={account.email ?? ""}>
              {account.email ?? "—"}
            </span>
          </span>
        </div>
      </div>
      {manage && own ? <p className="text-sm text-text-muted">{t("instance.accounts.ownAccount")}</p> : null}
      <Tabs
        label={t("instance.accounts.page.tabs")}
        value={tab}
        onValueChange={(value) => setTab(value as AccountTab)}
        tabs={tabs}
      >
        {tab === "overview" ? (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <AccountCard title={t("instance.accounts.account")}>
                <AccountFacts
                  rows={[
                    [t("instance.accounts.type"), t(`instance.accounts.types.${account.type}`)],
                    [
                      t("instance.accounts.state"),
                      <Badge
                        key="state"
                        variant={STATE_BADGES[account.state as keyof typeof STATE_BADGES] ?? "neutral"}
                      >
                        {t(`instance.accounts.states.${account.state}`)}
                      </Badge>,
                    ],
                    [
                      t("instance.accounts.instanceRole"),
                      account.instanceRoles.length > 0
                        ? account.instanceRoles.map((role) => instanceRoleName(t, role)).join(", ")
                        : "—",
                    ],
                    [t("instance.accounts.page.created"), format.date(account.createdAt)],
                    [
                      t("instance.accounts.lastSignIn"),
                      account.lastSignInAt
                        ? format.dateTime(account.lastSignInAt)
                        : t("instance.accounts.never"),
                    ],
                    [
                      t("instance.accounts.page.personalSpace"),
                      detail.personalSpaceKey ??
                        (account.type === "standard"
                          ? t("instance.accounts.page.noPersonalSpace")
                          : t("instance.accounts.page.noPersonalSpaceGuest")),
                    ],
                  ]}
                />
              </AccountCard>
              <AccountCard title={t("instance.accounts.page.securityAtAGlance")}>
                <AccountFacts
                  rows={[
                    ...(secondFactor
                      ? ([
                          [
                            t("instance.accounts.twoFactor"),
                            account.twoFactorActive ? (
                              t("instance.accounts.twoFactorOn")
                            ) : (
                              <Badge key="factor" variant="warning">
                                {t("instance.accounts.twoFactorOff")}
                              </Badge>
                            ),
                          ],
                          [
                            t("instance.accounts.page.passkeys"),
                            t("instance.accounts.passkeyCount", { count: detail.twoFactor.passkeys }),
                          ],
                        ] as [string, ReactNode][])
                      : []),
                    [
                      t("instance.accounts.activeSessions"),
                      t("instance.accounts.page.sessionCount", { count: detail.sessions.length }),
                    ],
                    [
                      t("instance.accounts.tokens"),
                      t("instance.accounts.page.tokenCount", { count: detail.tokens.length }),
                    ],
                  ]}
                />
              </AccountCard>
              <AccountCard
                title={t("instance.accounts.organizations")}
                count={detail.memberships.length}
                wide
              >
                {detail.memberships.length === 0 ? (
                  <p className="text-sm text-text-muted">{t("instance.accounts.noMemberships")}</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {detail.memberships.map((membership) => (
                      <li
                        key={membership.organizationId}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1"
                      >
                        {membership.home ? <HomeMark /> : null}
                        <span className="font-medium">{membership.name}</span>
                        <span className="text-text-muted">
                          {[
                            t(`members.kinds.${membership.kind}`),
                            membership.expiresAt
                              ? t("instance.accounts.page.until", { date: format.date(membership.expiresAt) })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                        <Link
                          to="/settings/organizations/$organizationId/members/$accountId"
                          params={{ organizationId: membership.organizationId, accountId: account.id }}
                          className="text-accent hover:underline focus-visible:focus-ring"
                        >
                          {t("instance.accounts.page.memberPage")}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </AccountCard>
            </div>
            {manage && !own && account.state === "deactivated" ? (
              <div>
                <Button size="sm" onClick={() => setAction("reactivate")}>
                  {t("instance.accounts.reactivate")}
                </Button>
              </div>
            ) : null}
            {manage &&
            account.type === "standard" &&
            account.state === "active" &&
            account.homeOrganizationId === null ? (
              <AssignOrganization accountId={account.id} onAssigned={refresh} />
            ) : null}
            {manage && account.state === "placeholder" ? (
              <PanelSection title={t("lifecycle.merge.title")}>
                <MergePlaceholder
                  placeholder={{ id: account.id, name: account.name }}
                  ownAccountId={session.account?.id ?? null}
                  onMerged={async () => {
                    await refresh();
                    onGone();
                  }}
                />
              </PanelSection>
            ) : null}
            {manage &&
            account.state === "active" &&
            account.type === "standard" &&
            account.homeOrganizationId !== null ? (
              <PanelSection title={t("lifecycle.home.title")}>
                <HomeOrganizationChange
                  accountId={account.id}
                  memberships={detail.memberships}
                  onChanged={async () => {
                    await refresh();
                    await onRefetch();
                  }}
                />
              </PanelSection>
            ) : null}
            {manage && !own && (account.state === "active" || anonymizable) ? (
              <DangerZone title={t("common.dangerZone")}>
                {account.state === "active" ? (
                  <>
                    <DangerAction
                      title={t("instance.accounts.endSessions")}
                      description={t("instance.accounts.endSessionsSummary", { name: account.name })}
                      action={dangerButton("endSessions", t("instance.accounts.endSessions"))}
                    />
                    <DangerAction
                      title={t("instance.accounts.resetSecondFactor")}
                      description={t("instance.accounts.resetSummary", { name: account.name })}
                      action={dangerButton("reset", t("instance.accounts.resetSecondFactor"))}
                    />
                    <DangerAction
                      title={t("members.actions.deactivate")}
                      description={t("instance.accounts.deactivateSummary")}
                      action={dangerButton("deactivate", t("members.actions.deactivate"))}
                    />
                  </>
                ) : null}
                {anonymizable ? (
                  <DangerAction
                    title={t("lifecycle.anonymize.title")}
                    description={t("lifecycle.anonymize.summary")}
                    action={dangerButton("anonymize", t("lifecycle.anonymize.open"))}
                  />
                ) : null}
              </DangerZone>
            ) : null}
          </div>
        ) : tab === "security" ? (
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {secondFactor ? (
                <AccountCard title={t("instance.accounts.twoFactorStatus")}>
                  <AccountFacts
                    rows={[
                      [
                        t("security.authenticatorApp"),
                        detail.twoFactor.totp
                          ? t("instance.accounts.twoFactorOn")
                          : t("instance.accounts.twoFactorOff"),
                      ],
                      [
                        t("instance.accounts.page.passkeys"),
                        t("instance.accounts.passkeyCount", { count: detail.twoFactor.passkeys }),
                      ],
                      [
                        t("instance.accounts.page.recoveryCodes"),
                        t("instance.accounts.recoveryCodeCount", { count: detail.twoFactor.recoveryCodes }),
                      ],
                    ]}
                  />
                </AccountCard>
              ) : null}
              <AccountCard title={t("identities.title")}>
                <AccountIdentities accountId={account.id} manage={manage} />
              </AccountCard>
            </div>
            <Table
              caption={t("instance.accounts.activeSessions")}
              rowKey={(entry) => entry.id}
              rows={detail.sessions}
              empty={<p className="p-4 text-text-muted">{t("instance.accounts.noSessions")}</p>}
              columns={[
                {
                  key: "device",
                  header: t("instance.accounts.page.device"),
                  grow: true,
                  cell: (entry) => device(entry),
                },
                {
                  key: "address",
                  header: t("instance.accounts.page.address"),
                  hideBelow: "sm",
                  cell: (entry) => <span className="text-text-muted">{entry.clientIp ?? "—"}</span>,
                },
                {
                  key: "signedIn",
                  header: t("instance.accounts.page.signedIn"),
                  hideBelow: "md",
                  cell: (entry) => format.dateTime(entry.createdAt),
                },
                {
                  key: "lastUsed",
                  header: t("instance.accounts.page.lastActive"),
                  cell: (entry) => format.relative(entry.lastUsedAt),
                },
                ...(manage && !own
                  ? [
                      {
                        key: "actions",
                        header: t("settings.actions"),
                        align: "end" as const,
                        sticky: true,
                        cell: (entry: AccountDetail["sessions"][number]) => (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("instance.accounts.page.endSessionOf", { device: device(entry) })}
                            onClick={() => setEnding(entry)}
                          >
                            {t("instance.accounts.page.endSession")}
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        ) : tab === "organizations" ? (
          <div className="flex flex-col gap-3">
            <Table
              caption={t("instance.accounts.organizations")}
              rowKey={(membership) => membership.organizationId}
              rows={detail.memberships}
              empty={<p className="p-4 text-text-muted">{t("instance.accounts.noMemberships")}</p>}
              columns={[
                {
                  key: "organization",
                  header: t("instance.accounts.organization"),
                  grow: true,
                  cell: (membership) => (
                    <span className="flex items-center gap-2 font-medium">
                      {membership.home ? <HomeMark /> : null}
                      {membership.name}
                    </span>
                  ),
                },
                {
                  key: "role",
                  header: t("members.role"),
                  cell: (membership) =>
                    membership.roles.length > 0
                      ? membership.roles
                          .map((role) =>
                            role.groupName
                              ? t("instance.accounts.roleViaGroup", {
                                  role: instanceRoleName(t, role),
                                  group: role.groupName,
                                })
                              : instanceRoleName(t, role),
                          )
                          .join(", ")
                      : t(`members.kinds.${membership.kind}`),
                },
                {
                  key: "since",
                  header: t("members.page.since"),
                  hideBelow: "sm",
                  cell: (membership) => format.date(membership.since),
                },
                {
                  key: "until",
                  header: t("members.page.accessUntil"),
                  hideBelow: "md",
                  cell: (membership) => (membership.expiresAt ? format.date(membership.expiresAt) : "—"),
                },
                {
                  key: "open",
                  header: t("settings.actions"),
                  align: "end",
                  cell: (membership) => (
                    <Link
                      to="/settings/organizations/$organizationId/members/$accountId"
                      params={{ organizationId: membership.organizationId, accountId: account.id }}
                      aria-label={t("instance.accounts.page.openIn", { organization: membership.name })}
                      className="text-accent hover:underline focus-visible:focus-ring"
                    >
                      {t("instance.accounts.page.open")}
                    </Link>
                  ),
                },
              ]}
            />
            <p className="text-sm text-text-muted">{t("instance.accounts.page.groupsInOrganizations")}</p>
          </div>
        ) : tab === "tokens" ? (
          <Table
            caption={t("instance.accounts.tokens")}
            rowKey={(token) => token.id}
            rows={detail.tokens}
            empty={<p className="p-4 text-text-muted">{t("instance.accounts.noTokens")}</p>}
            columns={[
              {
                key: "name",
                header: t("instance.accounts.page.tokenName"),
                grow: true,
                cell: (token) => token.name,
              },
              {
                key: "prefix",
                header: t("instance.accounts.page.tokenPrefix"),
                hideBelow: "sm",
                cell: (token) => <code className="font-mono text-sm">{token.prefix}</code>,
              },
              {
                key: "expires",
                header: t("instance.accounts.page.tokenExpires"),
                cell: (token) =>
                  token.expiresAt ? format.date(token.expiresAt) : t("instance.accounts.tokenNoExpiry"),
              },
              {
                key: "used",
                header: t("instance.accounts.page.tokenUsed"),
                hideBelow: "md",
                cell: (token) =>
                  token.lastUsedAt ? format.relative(token.lastUsedAt) : t("instance.accounts.never"),
              },
            ]}
          />
        ) : tab === "activity" ? (
          <div className="flex flex-col gap-3">
            <AuditLog scope="instance" personId={account.id} instanceOnly canExport={false} />
            <p className="text-sm text-text-muted">{t("instance.accounts.page.activityHint")}</p>
          </div>
        ) : null}
      </Tabs>
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(next) => {
          if (!next) setEnding(null);
        }}
        title={t("instance.accounts.page.endSessionTitle", { device: ending ? device(ending) : "" })}
        description={t("instance.accounts.page.endSessionDescription", { name: account.name })}
        confirmLabel={t("instance.accounts.page.endSession")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (ending) await endSession(ending);
        }}
      />
      {action === "anonymize" ? (
        <AnonymizeDialog
          account={{ id: account.id, name: account.name }}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await refresh();
            onGone();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={action === "deactivate" || action === "reactivate" || action === "endSessions"}
        onOpenChange={(next) => {
          if (!next) setAction(null);
        }}
        title={
          action === "deactivate"
            ? t("members.deactivateTitle", { name: account.name })
            : action === "reactivate"
              ? t("instance.accounts.reactivateTitle", { name: account.name })
              : t("instance.accounts.endSessionsTitle", { name: account.name })
        }
        description={
          action === "deactivate"
            ? t("members.deactivateDescription")
            : action === "reactivate"
              ? t("instance.accounts.reactivateDescription")
              : t("instance.accounts.endSessionsDescription", { name: account.name })
        }
        confirmLabel={
          action === "deactivate"
            ? t("members.actions.deactivate")
            : action === "reactivate"
              ? t("instance.accounts.reactivate")
              : t("instance.accounts.endSessions")
        }
        cancelLabel={t("common.cancel")}
        destructive={action !== "reactivate"}
        onConfirm={async () => {
          if (action && action !== "reset" && action !== "anonymize") await run(action);
        }}
      />
      {action === "reset" ? (
        <ResetSecondFactorDialog
          account={account}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await refresh();
          }}
        />
      ) : null}
    </>
  );
}

function AssignOrganization({
  accountId,
  onAssigned,
}: {
  accountId: string;
  onAssigned: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const organizations = useQuery({ ...instanceOrganizationsQuery, throwOnError: false });
  const [organizationId, setOrganizationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const assign = async () => {
    if (!organizationId) {
      setError(t("validation.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/instance/accounts/{accountId}/organization", {
          params: { path: { accountId } },
          body: { organizationId },
        }),
      );
      await onAssigned();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <PanelSection title={t("instance.accounts.assignTitle")}>
      <Notice variant="warning">{t("instance.accounts.withoutOrganizationHint")}</Notice>
      {organizations.isError ? (
        <LoadError
          what={t("failures.loadOrganizations")}
          error={organizations.error}
          onRetry={() => organizations.refetch()}
        />
      ) : null}
      <Field label={t("instance.accounts.organization")} {...(error ? { error } : {})}>
        <Select
          aria-label={t("instance.accounts.organization")}
          value={organizationId}
          placeholder={t("instance.accounts.chooseOrganization")}
          onValueChange={setOrganizationId}
          options={(organizations.data ?? []).map((organization) => ({
            value: organization.id,
            label: organization.name,
          }))}
        />
      </Field>
      <div>
        <Button variant="primary" size="sm" loading={busy} onClick={() => void assign()}>
          {t("instance.accounts.assign")}
        </Button>
      </div>
    </PanelSection>
  );
}

function canHaveSecondFactor(account: { type: string; state: string }): boolean {
  return (
    (account.type === "standard" || account.type === "guest") &&
    account.state !== "placeholder" &&
    account.state !== "anonymized"
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <div className="py-3">{children}</div>
    </Section>
  );
}

export function ResetSecondFactorDialog({
  account,
  onClose,
  onDone,
}: {
  account: { id: string; name: string };
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      setInvalid(true);
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await request(() =>
        api.POST("/api/v1/accounts/{accountId}/second-factor/reset", {
          params: { path: { accountId: account.id } },
          body: { reason: reason.trim() },
        }),
      );
      toast({
        title: t("instance.accounts.resetDone", { name: account.name, count: result.endedSessions }),
        variant: "success",
      });
      await onDone();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={t("instance.accounts.resetTitle", { name: account.name })}
      size="md"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm">{t("instance.accounts.resetDescription", { name: account.name })}</p>
        {error ? (
          <Notice variant="danger" title={t("failures.resetSecondFactor")}>
            {error}
          </Notice>
        ) : null}
        <Field
          label={t("instance.accounts.resetReason")}
          hint={t("instance.accounts.resetReasonHint", { name: account.name })}
          help={t("instance.accounts.resetReasonHelp", { name: account.name })}
          error={invalid ? t("instance.accounts.resetReasonRequired") : undefined}
        >
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(event) => {
              setReason(event.target.value);
              setInvalid(false);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="dangerPrimary" loading={busy} onClick={() => void submit()}>
            {t("instance.accounts.resetSecondFactor")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
