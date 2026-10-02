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
  Table,
  TableToolbar,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { Info, UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceKeys } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { AccountIdentities } from "../../components/linked-identities.js";
import { useServerTable } from "../../components/table-state.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const STATE_BADGES = {
  active: "success",
  invited: "info",
  deactivated: "neutral",
  anonymized: "neutral",
  placeholder: "neutral",
} as const;

type AccountPage = Awaited<ReturnType<typeof fetchAccounts>>;
type Account = AccountPage["items"][number];

function fetchAccounts(search: string, cursor: string | null) {
  return request(() =>
    api.GET("/api/v1/instance/accounts", {
      params: { query: { limit: 25, ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}) } },
    }),
  );
}

export function instanceRoleName(t: TFunction, role: { builtInRole: string | null; name?: string | null }) {
  return role.builtInRole ? translateKey(t, `roles.builtIn.${role.builtInRole}`) : (role.name ?? "");
}

export function InstanceAccountsScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const table = useServerTable([...instanceKeys.accounts], fetchAccounts);
  const [open, setOpen] = useState<Account | null>(null);

  return (
    <SettingsPage
      width="wide"
      title={t("instance.accounts.title")}
      description={t("instance.accounts.description")}
      icon={UserRound}
    >
      <TableToolbar
        search={{ ...table.search, label: t("members.search"), placeholder: t("members.search") }}
      />
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
                  <span className="font-medium">{account.name}</span>
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

type PanelAction = "deactivate" | "reactivate" | "endSessions" | "reset";

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
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: instanceKeys.accounts });
  };

  const run = async (kind: Exclude<PanelAction, "reset">) => {
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
    <Drawer open onOpenChange={(next) => (next ? undefined : onClose())} title={account.name} size="panel">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 text-sm">
          <span>{account.email ?? "—"}</span>
          <span className="text-text-muted">
            {t(`instance.accounts.types.${account.type}`)} · {t(`instance.accounts.states.${current.state}`)}
          </span>
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
                      <span className="font-medium">
                        {membership.name}
                        {membership.home ? ` · ${t("instance.accounts.home")}` : ""}
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
      </div>
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
          if (action && action !== "reset") await run(action);
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
