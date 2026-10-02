import { passwordSchema, totpCodeSchema } from "@pagehall/shared";
import { Button, Dialog, Field, Input, Notice, PasswordInput, SegmentedControl } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../api/client.js";
import { queryKeys } from "../api/queries.js";
import { request, setReauthenticationHandler } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../forms/use-schema-form.js";
import { getPasskeyAssertion, isPasskeyCancelled, passkeysSupported } from "./passkeys.js";

type Method = "password" | "totp" | "passkey";

let pending: ((confirmed: boolean) => void) | null = null;
const listeners = new Set<() => void>();
let open = false;

function setOpen(next: boolean) {
  open = next;
  for (const listener of listeners) listener();
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
const codeForm = z.object({ code: totpCodeSchema.min(1) });

export function ReauthenticationHost() {
  const isOpen = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => open,
  );
  useEffect(() => {
    setReauthenticationHandler(requestReauthentication);
    return () => setReauthenticationHandler(null);
  }, []);
  return isOpen ? <ReauthenticationDialog /> : null;
}

function ReauthenticationDialog() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const security = useQuery({
    queryKey: ["account", "security"],
    queryFn: () => request(() => api.GET("/api/v1/account/security"), { sessionHandling: false }),
    throwOnError: false,
  });
  const methods: Method[] = ["password"];
  if (security.data?.totp) methods.push("totp");
  if (security.data && security.data.passkeys.length > 0 && passkeysSupported()) methods.push("passkey");
  const [method, setMethod] = useState<Method>("password");
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) finish(false);
      }}
      title={t("reauthentication.title")}
      description={t("reauthentication.description")}
      size="sm"
    >
      <div className="flex flex-col gap-4">
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
            onSubmit={submitWith(
              code.handleSubmit((values) => confirm({ method: "totp", code: values.code })),
            )}
          >
            <Field label={t("auth.authenticatorCode")} error={code.formState.errors.code?.message}>
              <Input autoComplete="one-time-code" inputMode="numeric" autoFocus {...code.register("code")} />
            </Field>
            <DialogActions busy={busy} />
          </form>
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
      </div>
    </Dialog>
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
