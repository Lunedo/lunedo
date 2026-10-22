import { passwordSchema, totpCodeSchema } from "@lunedo/shared";
import { Button, Dialog, Field, Notice, PasswordInput, SegmentedControl } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../api/client.js";
import {
  type LinkedIdentity,
  ownIdentitiesQuery,
  reauthenticateWithDirectory,
} from "../api/identity-queries.js";
import { queryKeys, sessionQuery } from "../api/queries.js";
import { request, setReauthenticationHandler } from "../api/request.js";
import { CodeInput } from "../components/code-input.js";
import { directoryProblemMessage, problemMessage } from "../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../forms/use-schema-form.js";
import { getPasskeyAssertion, isPasskeyCancelled, passkeysSupported } from "./passkeys.js";
import { startProviderReauthentication } from "./provider-sign-in.js";

type Method = "password" | "totp" | "passkey" | "provider";

let pending: ((confirmed: boolean) => void) | null = null;
const listeners = new Set<() => void>();
let open = false;
let slots: string[] = [];

function notify() {
  for (const listener of listeners) listener();
}

function setOpen(next: boolean) {
  open = next;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useInlineReauthentication(enabled: boolean): { active: boolean; panel: ReactNode } {
  const id = useId();
  useEffect(() => {
    if (!enabled) return;
    slots = [...slots, id];
    notify();
    return () => {
      slots = slots.filter((slot) => slot !== id);
      notify();
    };
  }, [id, enabled]);
  const active = useSyncExternalStore(
    subscribe,
    () => open && slots.at(-1) === id,
    () => false,
  );
  return { active, panel: active ? <ReauthenticationPanel inline /> : null };
}

export function requestReauthentication(): Promise<boolean> {
  pending?.(false);
  return new Promise((resolve) => {
    pending = resolve;
    setOpen(true);
  });
}

function finish(confirmed: boolean) {
  const resolve = pending;
  pending = null;
  setOpen(false);
  resolve?.(confirmed);
}

const passwordForm = z.object({ password: passwordSchema });

function isDirectoryIdentity(identity: LinkedIdentity): boolean {
  return identity.providerType === "ldap";
}
const codeForm = z.object({ code: totpCodeSchema.min(1) });

export function ReauthenticationHost() {
  const isOpen = useSyncExternalStore(
    subscribe,
    () => open && slots.length === 0,
    () => false,
  );
  useEffect(() => {
    setReauthenticationHandler(requestReauthentication);
    return () => setReauthenticationHandler(null);
  }, []);
  return isOpen ? <ReauthenticationDialog /> : null;
}

function ReauthenticationDialog() {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
      title={t("reauthentication.title")}
      description={t("reauthentication.description")}
      size="sm"
    >
      <ReauthenticationPanel />
    </Dialog>
  );
}

function ReauthenticationPanel({ inline = false }: { inline?: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const security = useQuery({
    queryKey: ["account", "security"],
    queryFn: () => request(() => api.GET("/api/v1/account/security"), { sessionHandling: false }),
    throwOnError: false,
  });
  const session = useQuery({ ...sessionQuery, throwOnError: false });
  const identities = useQuery({ ...ownIdentitiesQuery, throwOnError: false });
  const providers: LinkedIdentity[] = identities.data ?? [];
  const redirected = providers.filter((identity) => !isDirectoryIdentity(identity));
  const directories = providers.filter(isDirectoryIdentity);
  const signedInWithProvider = session.data?.methods.includes("identityProvider") ?? false;
  const methods: Method[] =
    providers.length > 0 && signedInWithProvider ? ["provider", "password"] : ["password"];
  if (providers.length > 0 && !signedInWithProvider) methods.push("provider");
  if (security.data?.totp) methods.push("totp");
  if (security.data && security.data.passkeys.length > 0 && passkeysSupported()) methods.push("passkey");
  const [chosen, setMethod] = useState<Method | null>(null);
  const method = chosen ?? methods[0] ?? "password";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const password = useSchemaForm(passwordForm, { defaultValues: { password: "" } });
  const code = useSchemaForm(codeForm, { defaultValues: { code: "" } });

  const confirm = async (
    body: { method: "password"; password: string } | { method: "totp"; code: string },
  ) => {
    setBusy(true);
    setError(null);
    try {
      await request(() => api.POST("/api/v1/auth/reauthenticate", { body }), { sessionHandling: false });
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      finish(true);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  const confirmWithPasskey = async () => {
    setBusy(true);
    setError(null);
    try {
      const options = await request(() => api.POST("/api/v1/auth/reauthenticate/passkey-options"), {
        sessionHandling: false,
      });
      const response = await getPasskeyAssertion(options);
      await request(
        () =>
          api.POST("/api/v1/auth/reauthenticate", {
            body: { method: "passkey", response: response as never },
          }),
        { sessionHandling: false },
      );
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      finish(true);
    } catch (failure) {
      setError(isPasskeyCancelled(failure) ? t("auth.passkeyCancelled") : problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={t("reauthentication.title")} className="flex flex-col gap-4">
      {inline ? (
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">{t("reauthentication.title")}</h3>
          <p className="text-sm text-text-muted">{t("reauthentication.description")}</p>
        </div>
      ) : null}
      {methods.length > 1 ? (
        <SegmentedControl
          label={t("reauthentication.method")}
          value={method}
          onValueChange={(value) => {
            setMethod(value as Method);
            setError(null);
          }}
          options={methods.map((value) => ({ value, label: t(`reauthentication.methods.${value}`) }))}
        />
      ) : null}
      {error ? (
        <Notice variant="danger" title={t("failures.confirmIdentity")}>
          {error}
        </Notice>
      ) : null}
      {method === "password" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={submitWith(
            password.handleSubmit((values) => confirm({ method: "password", password: values.password })),
          )}
        >
          <Field label={t("auth.password")} error={password.formState.errors.password?.message}>
            <PasswordInput autoComplete="current-password" autoFocus {...password.register("password")} />
          </Field>
          <DialogActions busy={busy} />
        </form>
      ) : null}
      {method === "totp" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={submitWith(code.handleSubmit((values) => confirm({ method: "totp", code: values.code })))}
        >
          <Field label={t("auth.authenticatorCode")} error={code.formState.errors.code?.message}>
            <CodeInput control={code.control} name="code" autoFocus />
          </Field>
          <DialogActions busy={busy} />
        </form>
      ) : null}
      {method === "provider" ? (
        <div className="flex flex-col gap-4">
          {directories.map((identity) => (
            <DirectoryConfirm
              key={identity.id}
              identity={identity}
              onConfirmed={async () => {
                await queryClient.invalidateQueries({ queryKey: queryKeys.session });
                finish(true);
              }}
              onError={setError}
            />
          ))}
          {redirected.length > 0 ? (
            <Notice variant="info">{t("reauthentication.providerHint")}</Notice>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => finish(false)}>
              {t("common.cancel")}
            </Button>
            {redirected.map((identity) => (
              <Button
                key={identity.id}
                variant="primary"
                loading={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await startProviderReauthentication(
                        identity.providerId,
                        `${globalThis.location.pathname}${globalThis.location.search}`,
                      );
                    } catch (failure) {
                      setError(problemMessage(t, failure));
                      setBusy(false);
                    }
                  })()
                }
              >
                {t("reauthentication.withProvider", { name: identity.providerName })}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      {method === "passkey" ? (
        <div className="flex flex-col gap-4">
          <Notice variant="info">{t("auth.passkeyHint")}</Notice>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => finish(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              icon={Fingerprint}
              loading={busy}
              onClick={() => void confirmWithPasskey()}
            >
              {t("auth.usePasskey")}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DirectoryConfirm({
  identity,
  onConfirmed,
  onError,
}: {
  identity: LinkedIdentity;
  onConfirmed: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const form = useSchemaForm(passwordForm, { defaultValues: { password: "" } });
  const submit = form.handleSubmit(async ({ password }) => {
    onError(null);
    try {
      await reauthenticateWithDirectory(identity.providerId, password);
      await onConfirmed();
    } catch (failure) {
      onError(directoryProblemMessage(t, failure));
      form.resetField("password");
    }
  });
  return (
    <form className="flex flex-col gap-3" onSubmit={submitWith(submit)} noValidate>
      <Field
        label={t("reauthentication.directoryPassword", { name: identity.providerName })}
        error={form.formState.errors.password?.message}
      >
        <PasswordInput autoComplete="current-password" autoFocus {...form.register("password")} />
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" type="submit" loading={form.formState.isSubmitting}>
          {t("reauthentication.withDirectory", { name: identity.providerName })}
        </Button>
      </div>
    </form>
  );
}

function DialogActions({ busy }: { busy: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" type="button" onClick={() => finish(false)}>
        {t("common.cancel")}
      </Button>
      <Button variant="primary" type="submit" loading={busy}>
        {t("reauthentication.confirm")}
      </Button>
    </div>
  );
}
