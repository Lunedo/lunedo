import { emailSchema } from "@lunedo/shared";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  Input,
  List,
  ListRow,
  Notice,
  Section,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Mail, UserPlus, UserRound, Users } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { isApiError, request } from "../../api/request.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { SpaceSettingsPage } from "../../spaces/settings/space-settings-page.js";
import { useSpace } from "../../spaces/space-context.js";

const DAY_MS = 86_400_000;

function portalAccountsQuery(spaceId: string) {
  return {
    queryKey: ["spaces", spaceId, "knowledgeBase", "portalAccounts"] as const,
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/portal-accounts", { params: { path: { spaceId } } })),
  };
}

type PortalAccounts = Awaited<ReturnType<ReturnType<typeof portalAccountsQuery>["queryFn"]>>;
type PortalAccount = PortalAccounts["accounts"][number];
type PortalInvitation = PortalAccounts["invitations"][number];

function InviteDialog({
  open,
  onOpenChange,
  spaceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [expires, setExpires] = useState("");
  const [errors, setErrors] = useState<{ email?: string; expires?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const expiryRef = useRef<HTMLInputElement>(null);
  const close = (next: boolean) => {
    if (!next) {
      setEmail("");
      setExpires("");
      setErrors({});
    }
    onOpenChange(next);
  };
  const submit = async () => {
    const next: typeof errors = {};
    if (!emailSchema.safeParse(email.trim()).success) next.email = t("portalAccounts.invite.emailInvalid");
    const expiresAt = expires ? new Date(`${expires}T23:59:59`) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) {
      next.expires = t("portalAccounts.invite.expiryFuture");
    }
    setErrors(next);
    if (next.email) {
      emailRef.current?.focus();
      return;
    }
    if (next.expires) {
      expiryRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/portal-accounts", {
          params: { path: { spaceId } },
          body: { email: email.trim(), expiresAt: expiresAt?.toISOString() ?? null },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: portalAccountsQuery(spaceId).queryKey });
      toast({ title: t("portalAccounts.invite.sent", { email: email.trim() }), variant: "success" });
      close(false);
    } catch (failure) {
      setErrors({ form: problemMessage(t, failure) });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={close} title={t("portalAccounts.invite.title")} size="sm">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {errors.form ? (
          <Notice variant="danger" title={t("portalAccounts.invite.failed")}>
            {errors.form}
          </Notice>
        ) : null}
        <p className="text-sm text-text-muted">{t("portalAccounts.invite.description")}</p>
        <Field label={t("portalAccounts.invite.email")} error={errors.email}>
          <Input
            ref={emailRef}
            type="email"
            autoComplete="off"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field
          label={t("portalAccounts.invite.expiry")}
          hint={t("portalAccounts.invite.expiryDescription")}
          error={errors.expires}
        >
          <Input
            ref={expiryRef}
            type="date"
            min={new Date(Date.now() + DAY_MS).toISOString().slice(0, 10)}
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => close(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" icon={Mail} loading={saving}>
            {t("portalAccounts.invite.send")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function PortalAccountsScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const { toast } = useToast();
  const query = portalAccountsQuery(space.id);
  const accounts = useQuery({ ...query, enabled: !space.archived, throwOnError: false });
  const forbidden = isApiError(accounts.error, "forbidden");
  const manage = !space.archived && !forbidden;
  const [inviting, setInviting] = useState(false);
  const [deactivating, setDeactivating] = useState<PortalAccount | null>(null);
  const [removing, setRemoving] = useState<PortalAccount | null>(null);
  const [withdrawing, setWithdrawing] = useState<PortalInvitation | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: query.queryKey });
  const forPortal = space.audience === "portal";
  return (
    <SpaceSettingsPage title={t("portalAccounts.title")} description={t("portalAccounts.description")}>
      <div className="flex flex-col gap-6">
        {forPortal ? null : (
          <Notice variant="info" title={t("portalAccounts.notForPortalTitle")}>
            <p>{t("portalAccounts.notForPortal")}</p>
            <Link
              to="/spaces/$spaceKey/settings/visibility"
              params={{ spaceKey: space.key }}
              className="mt-2 inline-flex min-h-hit items-center text-accent hover:underline focus-visible:focus-ring"
            >
              {t("portalAccounts.toVisibility")}
            </Link>
          </Notice>
        )}
        {!manage ? <Notice variant="info">{t("portalAccounts.managersOnly")}</Notice> : null}
        {manage && accounts.isPending ? <Skeleton className="h-card w-full" /> : null}
        {accounts.isError && !forbidden ? (
          <LoadError
            what={t("portalAccounts.loadFailed")}
            error={accounts.error}
            onRetry={() => accounts.refetch()}
          />
        ) : null}
        {accounts.data ? (
          <>
            {forPortal || accounts.data.accounts.length > 0 ? (
              <Section
                title={t("portalAccounts.accounts")}
                icon={Users}
                actions={
                  forPortal ? (
                    <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setInviting(true)}>
                      {t("portalAccounts.invite.open")}
                    </Button>
                  ) : null
                }
              >
                {accounts.data.accounts.length === 0 ? (
                  <EmptyState
                    icon={UserRound}
                    title={t("portalAccounts.emptyTitle")}
                    description={t("portalAccounts.emptyDescription")}
                  />
                ) : (
                  <List label={t("portalAccounts.accounts")}>
                    {accounts.data.accounts.map((account) => (
                      <ListRow
                        key={account.id}
                        icon={UserRound}
                        title={
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate" title={account.name}>
                              {account.name}
                            </span>
                            {account.state === "deactivated" ? (
                              <Badge variant="neutral">{t("portalAccounts.deactivated")}</Badge>
                            ) : null}
                          </span>
                        }
                        description={[
                          account.email,
                          account.expiresAt
                            ? t("portalAccounts.expiresOn", { date: format.date(account.expiresAt) })
                            : t("portalAccounts.noExpiry"),
                          account.lastSignInAt
                            ? t("portalAccounts.lastSignIn", { when: format.relative(account.lastSignInAt) })
                            : t("portalAccounts.neverSignedIn"),
                        ].join(" · ")}
                        actions={
                          <span className="flex flex-wrap gap-2">
                            {account.state === "active" && !account.otherOrganizations ? (
                              <Button variant="secondary" size="sm" onClick={() => setDeactivating(account)}>
                                {t("portalAccounts.deactivate")}
                              </Button>
                            ) : null}
                            <Button variant="danger" size="sm" onClick={() => setRemoving(account)}>
                              {t("portalAccounts.remove")}
                            </Button>
                          </span>
                        }
                      />
                    ))}
                  </List>
                )}
              </Section>
            ) : null}
            {accounts.data.invitations.length > 0 ? (
              <Section title={t("portalAccounts.invitations")} icon={Mail}>
                <List label={t("portalAccounts.invitations")}>
                  {accounts.data.invitations.map((invitation) => (
                    <ListRow
                      key={invitation.id}
                      icon={Mail}
                      title={invitation.email}
                      description={[
                        t("portalAccounts.linkExpires", { date: format.date(invitation.expiresAt) }),
                        invitation.membershipExpiresAt
                          ? t("portalAccounts.expiresOn", {
                              date: format.date(invitation.membershipExpiresAt),
                            })
                          : t("portalAccounts.noExpiry"),
                      ].join(" · ")}
                      actions={
                        <Button variant="secondary" size="sm" onClick={() => setWithdrawing(invitation)}>
                          {t("portalAccounts.withdraw")}
                        </Button>
                      }
                    />
                  ))}
                </List>
              </Section>
            ) : null}
          </>
        ) : null}
      </div>
      <InviteDialog open={inviting} onOpenChange={setInviting} spaceId={space.id} />
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null);
        }}
        title={t("portalAccounts.deactivateTitle", { name: deactivating?.name ?? "" })}
        description={t("portalAccounts.deactivateDescription")}
        confirmLabel={t("portalAccounts.deactivateConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!deactivating) return;
          try {
            await request(() =>
              api.POST("/api/v1/spaces/{spaceId}/portal-accounts/{accountId}/deactivate", {
                params: { path: { spaceId: space.id, accountId: deactivating.id } },
              }),
            );
            await refresh();
            toast({ title: t("portalAccounts.deactivated"), variant: "success" });
          } catch (failure) {
            showFailure(t("portalAccounts.deactivateFailed"), failure);
            throw failure;
          }
        }}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("portalAccounts.removeTitle", { name: removing?.name ?? "" })}
        description={t("portalAccounts.removeDescription")}
        confirmLabel={t("portalAccounts.removeConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/spaces/{spaceId}/portal-accounts/{accountId}", {
                params: { path: { spaceId: space.id, accountId: removing.id } },
              }),
            );
            await refresh();
            toast({ title: t("portalAccounts.removed"), variant: "success" });
          } catch (failure) {
            showFailure(t("portalAccounts.removeFailed"), failure);
            throw failure;
          }
        }}
      />
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(open) => {
          if (!open) setWithdrawing(null);
        }}
        title={t("portalAccounts.withdrawTitle", { email: withdrawing?.email ?? "" })}
        description={t("portalAccounts.withdrawDescription")}
        confirmLabel={t("portalAccounts.withdrawConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!withdrawing) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/spaces/{spaceId}/portal-invitations/{invitationId}", {
                params: { path: { spaceId: space.id, invitationId: withdrawing.id } },
              }),
            );
            await refresh();
          } catch (failure) {
            showFailure(t("portalAccounts.withdrawFailed"), failure);
            throw failure;
          }
        }}
      />
    </SpaceSettingsPage>
  );
}
