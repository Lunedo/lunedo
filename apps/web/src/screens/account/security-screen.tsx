import { emailSchema, passkeyNameSchema, passwordSchema } from "@pagehall/shared";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  List,
  ListRow,
  Notice,
  PasswordInput,
  Section,
  SettingRow,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, KeyRound, LockKeyhole, Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  type ApiToken,
  accountKeys,
  ownTokensQuery,
  securityQuery,
  sessionsQuery,
  tokenLifetimeQuery,
} from "../../api/account-queries.js";
import { api } from "../../api/client.js";
import { instanceInfoQuery } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { RecoveryCodes } from "../../components/recovery-codes.js";
import { SecurityActivitySection } from "../../components/security-activity.js";
import { CreateTokenDialog, RevokeTokenDialog, scopeSummary } from "../../components/token-dialogs.js";
import { TotpEnrollment } from "../../components/totp-enrollment.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { createPasskey, isPasskeyCancelled, passkeysSupported } from "../../session/passkeys.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function SecurityScreen() {
  const { t } = useTranslation();
  const session = useSession();
  return (
    <SettingsPage title={t("security.title")} description={t("security.description")} icon={LockKeyhole}>
      <SignInSection />
      <TwoFactorSection />
      <SessionsSection />
      <TokensSection />
      {session.account ? <SecurityActivitySection accountId={session.account.id} /> : null}
    </SettingsPage>
  );
}

function SignInSection() {
  const { t } = useTranslation();
  const session = useSession();
  const [dialog, setDialog] = useState<"password" | "email" | null>(null);
  return (
    <Section title={t("security.signIn")}>
      <SettingRow
        label={t("auth.password")}
        description={t("security.passwordDescription")}
        control={
          <Button variant="outline" onClick={() => setDialog("password")}>
            {t("security.changePassword")}
          </Button>
        }
      />
      <SettingRow
        label={t("auth.email")}
        description={session.account?.email ?? ""}
        control={
          <Button variant="outline" onClick={() => setDialog("email")}>
            {t("security.changeEmail")}
          </Button>
        }
      />
      <ChangePasswordDialog
        open={dialog === "password"}
        onOpenChange={(open) => setDialog(open ? "password" : null)}
      />
      <ChangeEmailDialog
        open={dialog === "email"}
        onOpenChange={(open) => setDialog(open ? "email" : null)}
      />
    </Section>
  );
}

const passwordForm = z
  .object({ password: passwordSchema, repeated: z.string() })
  .refine((values) => values.password === values.repeated, { path: ["repeated"], message: "mismatch" });

function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const info = useQuery(instanceInfoQuery);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(passwordForm, {
    defaultValues: { password: "", repeated: "" },
    messages: { repeated: t("auth.passwordsDiffer") },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() => api.POST("/api/v1/account/password", { body: { password: values.password } }));
      await queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
      toast({ title: t("security.passwordChanged"), variant: "success" });
      form.reset();
      onOpenChange(false);
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("security.changePassword")} size="sm">
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.changePassword")}>
            {error}
          </Notice>
        ) : null}
        <Field
          label={t("auth.newPassword")}
          hint={t("auth.passwordHint", { minimum: info.data?.passwordMinLength ?? 12 })}
          error={form.formState.errors.password?.message}
        >
          <PasswordInput autoComplete="new-password" autoFocus {...form.register("password")} />
        </Field>
        <Field label={t("auth.repeatPassword")} error={form.formState.errors.repeated?.message}>
          <PasswordInput autoComplete="new-password" {...form.register("repeated")} />
        </Field>
        <p className="text-sm text-text-muted">{t("security.otherSessionsEnd")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("security.changePassword")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const emailForm = z.object({ email: emailSchema });

function ChangeEmailDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(emailForm, { defaultValues: { email: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() => api.POST("/api/v1/account/email", { body: values }));
      toast({ title: t("security.emailConfirmationSent"), variant: "success" });
      form.reset();
      onOpenChange(false);
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("security.changeEmail")}
      description={t("security.changeEmailDescription")}
      size="sm"
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.changeEmail")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("security.newEmail")} error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("security.sendConfirmation")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TwoFactorSection() {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const security = useQuery({ ...securityQuery, throwOnError: false });
  const [dialog, setDialog] = useState<"totp" | "removeTotp" | "passkey" | "codes" | null>(null);
  const [removePasskey, setRemovePasskey] = useState<{ id: string; name: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.security });

  const generateCodes = useMutation({
    mutationFn: () => request(() => api.POST("/api/v1/account/recovery-codes")),
    onSuccess: async (result) => {
      setCodes(result.recoveryCodes);
      setDialog(null);
      await refresh();
    },
    onError: (failure) => showFailure(t("failures.generateRecoveryCodes"), failure),
  });

  if (security.isPending) return <Skeleton className="h-12 w-full" />;
  if (security.isError)
    return (
      <LoadError
        what={t("failures.loadSecurity")}
        error={security.error}
        onRetry={() => security.refetch()}
      />
    );
  const data = security.data;
  const hasFactor = data.totp || data.passkeys.length > 0;

  return (
    <Section title={t("security.twoFactor")}>
      {data.secondFactorRequired ? (
        <div className="px-4 pt-4">
          <Notice variant="info">{t("security.twoFactorRequired")}</Notice>
        </div>
      ) : null}
      <SettingRow
        label={t("security.authenticatorApp")}
        description={data.totp ? t("security.authenticatorOn") : t("security.authenticatorOff")}
        control={
          data.totp ? (
            <div className="flex items-center gap-2">
              <Badge variant="success">{t("common.on")}</Badge>
              <Button variant="danger" onClick={() => setDialog("removeTotp")}>
                {t("common.remove")}
              </Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setDialog("totp")}>
              {t("security.setUp")}
            </Button>
          )
        }
      />
      <SettingRow
        label={t("security.passkeys")}
        description={
          data.passkeys.length === 0 ? t("security.noPasskeys") : t("security.passkeysDescription")
        }
        control={
          passkeysSupported() ? (
            <Button variant="outline" icon={Plus} onClick={() => setDialog("passkey")}>
              {t("security.addPasskey")}
            </Button>
          ) : (
            <span className="text-sm text-text-muted">{t("security.passkeysUnsupported")}</span>
          )
        }
      />
      {data.passkeys.length > 0 ? (
        <List>
          {data.passkeys.map((passkey) => (
            <ListRow
              key={passkey.id}
              icon={Fingerprint}
              title={passkey.name}
              description={t("security.passkeyDetails", {
                created: format.date(passkey.createdAt),
                used: passkey.lastUsedAt ? format.relative(passkey.lastUsedAt) : t("common.never"),
              })}
              actions={
                <Button variant="danger" icon={Trash2} onClick={() => setRemovePasskey(passkey)}>
                  {t("common.remove")}
                </Button>
              }
            />
          ))}
        </List>
      ) : null}
      <SettingRow
        label={t("security.recoveryCodes")}
        description={
          hasFactor
            ? t("security.recoveryCodesLeft", { count: data.recoveryCodes })
            : t("security.recoveryCodesNeedFactor")
        }
        control={
          <Button variant="outline" disabled={!hasFactor} onClick={() => setDialog("codes")}>
            {t("security.newCodes")}
          </Button>
        }
      />
      <Dialog
        open={dialog === "totp"}
        onOpenChange={(open) => setDialog(open ? "totp" : null)}
        title={t("security.setUpAuthenticator")}
        size="md"
      >
        <TotpEnrollment
          queryKey={["account", "totp", "enrollment"]}
          begin={() => request(() => api.POST("/api/v1/account/totp"))}
          confirm={async (code) => {
            const result = await request(() => api.POST("/api/v1/account/totp/confirm", { body: { code } }));
            setDialog(null);
            queryClient.removeQueries({ queryKey: ["account", "totp", "enrollment"] });
            if (result.recoveryCodes) setCodes(result.recoveryCodes);
            toast({ title: t("security.authenticatorAdded"), variant: "success" });
            await refresh();
          }}
        />
      </Dialog>
      <ConfirmDialog
        open={dialog === "removeTotp"}
        onOpenChange={(open) => setDialog(open ? "removeTotp" : null)}
        title={t("security.removeAuthenticatorTitle")}
        description={t("security.removeAuthenticatorDescription")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          try {
            await request(() => api.DELETE("/api/v1/account/totp"));
            toast({ title: t("security.authenticatorRemoved"), variant: "success" });
            setDialog(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.removeAuthenticator"), failure);
          }
        }}
      />
      <AddPasskeyDialog
        open={dialog === "passkey"}
        onOpenChange={(open) => setDialog(open ? "passkey" : null)}
        onAdded={async (recoveryCodes) => {
          setDialog(null);
          if (recoveryCodes) setCodes(recoveryCodes);
          await refresh();
        }}
      />
      <ConfirmDialog
        open={removePasskey !== null}
        onOpenChange={(open) => {
          if (!open) setRemovePasskey(null);
        }}
        title={t("security.removePasskeyTitle", { name: removePasskey?.name ?? "" })}
        description={t("security.removePasskeyDescription")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removePasskey) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/account/passkeys/{id}", { params: { path: { id: removePasskey.id } } }),
            );
            setRemovePasskey(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.removePasskey"), failure);
          }
        }}
      />
      <ConfirmDialog
        open={dialog === "codes"}
        onOpenChange={(open) => setDialog(open ? "codes" : null)}
        title={t("security.newCodesTitle")}
        description={t("security.newCodesDescription")}
        confirmLabel={t("security.newCodes")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => generateCodes.mutateAsync().then(() => undefined)}
      />
      <Dialog
        open={codes !== null}
        onOpenChange={(open) => {
          if (!open) setCodes(null);
        }}
        title={t("security.recoveryCodes")}
        size="md"
      >
        {codes ? <RecoveryCodes codes={codes} /> : null}
      </Dialog>
    </Section>
  );
}

const passkeyForm = z.object({ name: passkeyNameSchema });

function AddPasskeyDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (recoveryCodes: string[] | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(passkeyForm, { defaultValues: { name: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const options = await request(() => api.POST("/api/v1/account/passkeys/registration-options"));
      const response = await createPasskey(options);
      const added = await request(() =>
        api.POST("/api/v1/account/passkeys", { body: { response: response as never, name: values.name } }),
      );
      form.reset();
      await onAdded(added.recoveryCodes);
    } catch (failure) {
      setError(isPasskeyCancelled(failure) ? t("auth.passkeyCancelled") : problemMessage(t, failure));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("security.addPasskey")} size="sm">
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.addPasskey")}>
            {error}
          </Notice>
        ) : null}
        <Field
          label={t("security.passkeyName")}
          hint={t("security.passkeyNameHint")}
          error={form.formState.errors.name?.message}
        >
          <Input autoComplete="off" autoFocus {...form.register("name")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" icon={Fingerprint} loading={form.formState.isSubmitting}>
            {t("security.addPasskey")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function SessionsSection() {
  const { t } = useTranslation();
  const format = useFormat();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const sessions = useQuery(sessionsQuery);
  const [ending, setEnding] = useState<"others" | string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
  const others = sessions.data?.filter((session) => !session.current) ?? [];

  return (
    <Section
      title={t("security.sessions")}
      actions={
        others.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={() => setEnding("others")}>
            {t("security.endOthers")}
          </Button>
        ) : null
      }
    >
      {sessions.isPending ? <Skeleton className="h-12 w-full" /> : null}
      <List>
        {sessions.data?.map((session) => {
          const device = [session.browser, session.operatingSystem].filter(Boolean).join(" · ");
          const mobile = /iOS|Android/i.test(session.operatingSystem ?? "");
          return (
            <ListRow
              key={session.id}
              icon={mobile ? Smartphone : Monitor}
              title={device || t("security.unknownDevice")}
              description={t("security.sessionDetails", {
                ip: session.clientIp ?? t("common.unknown"),
                used: format.relative(session.lastUsedAt),
              })}
              actions={
                session.current ? (
                  <Badge variant="accent">{t("security.thisDevice")}</Badge>
                ) : (
                  <Button variant="outline" onClick={() => setEnding(session.id)}>
                    {t("security.endSession")}
                  </Button>
                )
              }
            />
          );
        })}
      </List>
      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => {
          if (!open) setEnding(null);
        }}
        title={ending === "others" ? t("security.endOthersTitle") : t("security.endSessionTitle")}
        description={
          ending === "others" ? t("security.endOthersDescription") : t("security.endSessionDescription")
        }
        confirmLabel={ending === "others" ? t("security.endOthers") : t("security.endSession")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          try {
            if (ending === "others") await request(() => api.POST("/api/v1/account/sessions/end-others"));
            else if (ending)
              await request(() =>
                api.DELETE("/api/v1/account/sessions/{id}", { params: { path: { id: ending } } }),
              );
            setEnding(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.endSession"), failure);
          }
        }}
      />
    </Section>
  );
}

function TokensSection() {
  const { t } = useTranslation();
  const format = useFormat();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const organization = useOrganizationState();
  const tokens = useQuery(ownTokensQuery);
  const [creating, setCreating] = useState(false);
  const lifetime = useQuery({
    ...tokenLifetimeQuery(organization.organizationId),
    enabled: creating,
    throwOnError: false,
  });
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.tokens });
  const instanceAccess = [
    ...[
      "instance.organizations.view",
      "instance.settings.view",
      "instance.accounts.view",
      "instance.audit.view",
    ],
  ].some((action) => organization.can(action));

  return (
    <Section
      title={t("tokens.personal")}
      actions={
        <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
          {t("tokens.create")}
        </Button>
      }
    >
      {tokens.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {tokens.data?.length === 0 ? <p className="px-4 py-3 text-text-muted">{t("tokens.none")}</p> : null}
      <List>
        {tokens.data?.map((token) => (
          <ListRow
            key={token.id}
            icon={KeyRound}
            title={token.name}
            description={[
              scopeSummary(t, token.scopes),
              token.expiresAt
                ? t("tokens.expiresOn", { date: format.date(token.expiresAt) })
                : t("tokens.noExpiry"),
              token.lastUsedAt
                ? t("tokens.lastUsed", { when: format.relative(token.lastUsedAt) })
                : t("tokens.neverUsed"),
            ].join(" · ")}
            actions={
              <Button variant="danger" onClick={() => setRevoking(token)}>
                {t("tokens.revoke")}
              </Button>
            }
          />
        ))}
      </List>
      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        maxLifetimeDays={lifetime.data ?? null}
        allowInstance={instanceAccess}
        allowOrganization={organization.organizationId !== null}
        onCreate={async (input) => {
          const created = await request(() =>
            api.POST("/api/v1/account/tokens", {
              body: {
                ...input,
                ...(input.scopes.organization && organization.organizationId
                  ? { organizationId: organization.organizationId }
                  : {}),
              },
            }),
          );
          await refresh();
          return created;
        }}
      />
      <RevokeTokenDialog
        token={revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        onRevoke={async () => {
          if (!revoking) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/account/tokens/{tokenId}", { params: { path: { tokenId: revoking.id } } }),
            );
            setRevoking(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.revokeToken"), failure);
          }
        }}
      />
    </Section>
  );
}
