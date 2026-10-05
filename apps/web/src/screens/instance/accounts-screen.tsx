import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Drawer,
  Field,
  IconButton,
  Notice,
  Section,
  Select,
  Table,
  TableToolbar,
  Textarea,
  Tooltip,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { House, Info, UserPlus, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceKeys, instanceOrganizationsQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { formerUser } from "../../components/audit-presentation.js";
import { AccountIdentities } from "../../components/linked-identities.js";
import { useServerTable } from "../../components/table-state.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import {
  AnonymizeDialog,
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

type AccountFilter = "all" | "withoutOrganization" | (typeof STATE_FILTERS)[number];

function fetchAccounts(search: string, cursor: string | null, filter: AccountFilter = "all") {
  return request(() =>
    api.GET("/api/v1/instance/accounts", {
      params: {
        query: {
          limit: 25,
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
  const table = useServerTable([...instanceKeys.accounts, filter], (search, cursor) =>
    fetchAccounts(search, cursor, filter),
  );
  const [open, setOpen] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const manage = useOrganizationState().can("instance.accounts.manage");

  return (
    <SettingsPage
      width="wide"
      title={t("instance.accounts.title")}
      description={t("instance.accounts.description")}
      icon={UserRound}
    >
      <TableToolbar
        search={{ ...table.search, label: t("members.search"), placeholder: t("members.search") }}
        filters={
          <div className="w-field max-w-full">
            <Select
              aria-label={t("instance.accounts.filter")}
              value={filter}
              onValueChange={(value) => setFilter(value as AccountFilter)}
              options={[
                { value: "all", label: t("instance.accounts.filterAll") },
                { value: "withoutOrganization", label: t("instance.accounts.withoutOrganization") },
                ...STATE_FILTERS.map((state) => ({
                  value: state,
                  label: t(`instance.accounts.states.${state}`),
                })),
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
      {table.query.isError ? (
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
          {...(table.pagination ? { pagination: table.pagination } : {})}
          onRowClick={setOpen}
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
                account.twoFactorActive ? (
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
                account.lastSignInAt ? format.dateTime(account.lastSignInAt) : t("instance.accounts.never"),
            },
            {
              key: "created",
              header: t("instance.accounts.created"),
              hideBelow: "md",
              cell: (account) => format.date(account.createdAt),
            },
          ]}
        />
      )}
      {open ? <AccountPanel account={open} onClose={() => setOpen(null)} /> : null}
    </SettingsPage>
  );
}

function HomeMark() {
  const { t } = useTranslation();
  return (
    <Tooltip content={t("instance.accounts.homeHint")}>
      <span
        role="img"
        aria-label={t("instance.accounts.homeHint")}
        className="inline-flex shrink-0 text-text-muted"
      >
        <House aria-hidden className="size-4" />
      </span>
    </Tooltip>
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

function AccountPanel({ account, onClose }: { account: Account; onClose: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  const session = useSession();
  const state = useOrganizationState();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const { toast } = useToast();
  const [action, setAction] = useState<PanelAction | null>(null);
  const detail = useQuery({
    queryKey: [...instanceKeys.accounts, "detail", account.id],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/accounts/{accountId}", { params: { path: { accountId: account.id } } }),
      ),
    throwOnError: false,
  });
  const own = account.id === session.account?.id;
  const manage = state.can("instance.accounts.manage");
  const current = detail.data?.account ?? account;
  const home = current.organizations.find((organization) => organization.home);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: instanceKeys.accounts });
  };

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

  const ownReason = own ? t("instance.accounts.ownAccount") : undefined;
  const actionButton = (kind: PanelAction, label: string, danger = false) => (
    <Button
      variant={danger ? "danger" : "secondary"}
      size="sm"
      disabled={own}
      onClick={() => setAction(kind)}
    >
      {label}
    </Button>
  );

  return (
    <Drawer
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={accountName(t, account)}
      size="panel"
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-sm">
          <span>{account.email ?? "—"}</span>
          <span className="text-text-muted">
            {t(`instance.accounts.types.${account.type}`)} · {t(`instance.accounts.states.${current.state}`)}
          </span>
          {home ? <span>{t("instance.accounts.managedBy", { organization: home.name })}</span> : null}
        </div>
        {manage ? (
          <div className="flex flex-col gap-2">
            {own ? <p className="text-sm text-text-muted">{ownReason}</p> : null}
            <div className="flex flex-wrap gap-2">
              {current.state === "active"
                ? actionButton("deactivate", t("members.actions.deactivate"), true)
                : current.state === "deactivated"
                  ? actionButton("reactivate", t("instance.accounts.reactivate"))
                  : null}
              {current.state === "active"
                ? actionButton("endSessions", t("instance.accounts.endSessions"))
                : null}
              {current.state === "active"
                ? actionButton("reset", t("instance.accounts.resetSecondFactor"))
                : null}
            </div>
          </div>
        ) : null}
        {manage &&
        account.type === "standard" &&
        current.state === "active" &&
        current.homeOrganizationId === null ? (
          <AssignOrganization accountId={account.id} onAssigned={refresh} />
        ) : null}
        {manage && current.state === "placeholder" ? (
          <PanelSection title={t("lifecycle.merge.title")}>
            <MergePlaceholder
              placeholder={{ id: account.id, name: account.name }}
              ownAccountId={session.account?.id ?? null}
              onMerged={async () => {
                await refresh();
                onClose();
              }}
            />
          </PanelSection>
        ) : null}
        {manage &&
        current.state === "active" &&
        account.type === "standard" &&
        current.homeOrganizationId !== null &&
        detail.data ? (
          <PanelSection title={t("lifecycle.home.title")}>
            <HomeOrganizationChange
              accountId={account.id}
              memberships={detail.data.memberships}
              onChanged={async () => {
                await refresh();
                await detail.refetch();
              }}
            />
          </PanelSection>
        ) : null}
        {detail.isError ? (
          <LoadError what={t("failures.loadAccount")} error={detail.error} onRetry={() => detail.refetch()} />
        ) : null}
        {detail.data ? (
          <>
            <PanelSection title={t("instance.accounts.twoFactorStatus")}>
              <ul className="flex flex-col gap-1 text-sm">
                <li>
                  {t("security.authenticatorApp")}:{" "}
                  {detail.data.twoFactor.totp
                    ? t("instance.accounts.twoFactorOn")
                    : t("instance.accounts.twoFactorOff")}
                </li>
                <li>{t("instance.accounts.passkeyCount", { count: detail.data.twoFactor.passkeys })}</li>
                <li>
                  {t("instance.accounts.recoveryCodeCount", { count: detail.data.twoFactor.recoveryCodes })}
                </li>
              </ul>
            </PanelSection>
            <PanelSection title={t("identities.title")}>
              <AccountIdentities accountId={account.id} manage={manage} />
            </PanelSection>
            <PanelSection title={t("instance.accounts.memberships")}>
              {detail.data.memberships.length === 0 ? (
                <p className="text-sm text-text-muted">{t("instance.accounts.noMemberships")}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {detail.data.memberships.map((membership) => (
                    <li key={membership.organizationId} className="flex flex-col">
                      <span className="flex items-center gap-1.5 font-medium">
                        {membership.home ? <HomeMark /> : null}
                        {membership.name}
                      </span>
                      <span className="text-text-muted">
                        {t(`members.kinds.${membership.kind}`)}
                        {membership.roles.length > 0
                          ? ` · ${membership.roles
                              .map((role) =>
                                role.groupName
                                  ? t("instance.accounts.roleViaGroup", {
                                      role: instanceRoleName(t, role),
                                      group: role.groupName,
                                    })
                                  : instanceRoleName(t, role),
                              )
                              .join(", ")}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </PanelSection>
            <PanelSection title={t("instance.accounts.activeSessions")}>
              {detail.data.sessions.length === 0 ? (
                <p className="text-sm text-text-muted">{t("instance.accounts.noSessions")}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {detail.data.sessions.map((entry) => (
                    <li key={entry.id} className="flex flex-col">
                      <span>
                        {[entry.browser, entry.operatingSystem].filter(Boolean).join(" · ") ||
                          t("instance.accounts.unknownBrowser")}
                      </span>
                      <span className="text-text-muted">
                        {[entry.clientIp, format.dateTime(entry.lastUsedAt ?? entry.createdAt)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </PanelSection>
            <PanelSection title={t("instance.accounts.tokens")}>
              {detail.data.tokens.length === 0 ? (
                <p className="text-sm text-text-muted">{t("instance.accounts.noTokens")}</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {detail.data.tokens.map((token) => (
                    <li key={token.id} className="flex flex-col">
                      <span className="font-medium">{token.name}</span>
                      <span className="text-text-muted">
                        {token.expiresAt
                          ? t("instance.accounts.tokenExpires", { date: format.date(token.expiresAt) })
                          : t("instance.accounts.tokenNoExpiry")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </PanelSection>
          </>
        ) : null}
        {manage &&
        !own &&
        current.state !== "anonymized" &&
        (account.type === "standard" || account.type === "guest") ? (
          <section className="flex flex-col gap-2 rounded-md border border-danger p-4">
            <h3 className="font-semibold">{t("lifecycle.anonymize.title")}</h3>
            <p className="text-sm text-text-muted">{t("lifecycle.anonymize.summary")}</p>
            <div>
              <Button variant="danger" size="sm" onClick={() => setAction("anonymize")}>
                {t("lifecycle.anonymize.open")}
              </Button>
            </div>
          </section>
        ) : null}
      </div>
      {action === "anonymize" ? (
        <AnonymizeDialog
          account={{ id: account.id, name: current.name }}
          onClose={() => setAction(null)}
          onDone={async () => {
            setAction(null);
            await refresh();
            onClose();
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
    </Drawer>
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

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <div className="px-4 py-3">{children}</div>
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
