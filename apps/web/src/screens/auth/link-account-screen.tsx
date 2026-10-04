import { passwordSchema, recoveryCodeSchema, totpCodeSchema } from "@pagehall/shared";
import {
  Badge,
  Button,
  Dialog,
  Field,
  Input,
  Notice,
  PasswordInput,
  SegmentedControl,
  Skeleton,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BadgeCheck, Fingerprint, KeyRound, LogIn } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { queryKeys } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { getPasskeyAssertion, isPasskeyCancelled, passkeysSupported } from "../../session/passkeys.js";
import { AuthCard } from "./auth-layout.js";

type Factor = "totp" | "passkey" | "recoveryCode";

type LinkFactor =
  | { type: "totp"; code: string }
  | { type: "recoveryCode"; code: string }
  | { type: "passkey"; response: never }
  | null;

export const linkQuery = {
  queryKey: ["auth", "link"] as const,
  queryFn: () => request(() => api.GET("/api/v1/auth/link"), { sessionHandling: false }),
  retry: false,
};

const linkForm = z.object({ password: z.string(), code: z.string() });

type Provider = { id: string; name: string; directory: boolean };

export function LinkAccountScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pending = useQuery(linkQuery);
  const factors = (pending.data?.factors ?? []).filter(
    (factor): factor is Factor => factor !== "passkey" || passkeysSupported(),
  );
  const [factor, setFactor] = useState<Factor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [directory, setDirectory] = useState<Provider | null>(null);
  const [directoryPassword, setDirectoryPassword] = useState("");
  const form = useSchemaForm(linkForm, { defaultValues: { password: "", code: "" } });
  const active = factor ?? factors[0] ?? null;
  const confirmed = pending.data?.confirmed ?? false;
  const withPassword = !confirmed && (pending.data?.password ?? false);
  const withPasskey = !confirmed && (pending.data?.passkey ?? false) && passkeysSupported();
  const providers = confirmed ? [] : (pending.data?.providers ?? []);

  const finish = async (sessionKind: string) => {
    queryClient.removeQueries({ queryKey: linkQuery.queryKey });
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    await navigate({ to: sessionKind === "secondFactorSetup" ? "/second-factor-setup" : "/" });
  };

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      if (!confirmed && !passwordSchema.safeParse(values.password).success) {
        form.setError("password", { message: t("validation.required") });
        return;
      }
      let second: LinkFactor = null;
      if (active === "totp") {
        const code = totpCodeSchema.min(1).safeParse(values.code);
        if (!code.success) {
          form.setError("code", { message: t("validation.format") });
          return;
        }
        second = { type: "totp", code: code.data };
      }
      if (active === "recoveryCode") {
        const code = recoveryCodeSchema.min(1).safeParse(values.code);
        if (!code.success) {
          form.setError("code", { message: t("validation.format") });
          return;
        }
        second = { type: "recoveryCode", code: code.data };
      }
      if (active === "passkey") {
        const options = await request(
          () => api.POST("/api/v1/auth/link/passkey-options", { body: { use: "secondFactor" } }),
          { sessionHandling: false },
        );
        const response = await getPasskeyAssertion(options);
        second = { type: "passkey", response: response as never };
      }
      const result = await request(
        () =>
          api.POST("/api/v1/auth/link", {
            body: confirmed ? { factor: second } : { password: values.password, factor: second },
          }),
        { sessionHandling: false },
      );
      await finish(result.sessionKind);
    } catch (failure) {
      setError(isPasskeyCancelled(failure) ? t("auth.passkeyCancelled") : problemMessage(t, failure));
      form.resetField("password");
      form.resetField("code");
    }
  });

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(isPasskeyCancelled(failure) ? t("auth.passkeyCancelled") : problemMessage(t, failure));
    } finally {
      setBusy(null);
    }
  };

  const confirmWithPasskey = () =>
    run("passkey", async () => {
      const options = await request(
        () => api.POST("/api/v1/auth/link/passkey-options", { body: { use: "signIn" } }),
        { sessionHandling: false },
      );
      const response = await getPasskeyAssertion(options);
      const result = await request(
        () => api.POST("/api/v1/auth/link", { body: { passkey: response as never } }),
        { sessionHandling: false },
      );
      await finish(result.sessionKind);
    });

  const confirmWithProvider = (provider: Provider) =>
    run(provider.id, async () => {
      const started = await request(
        () => api.POST("/api/v1/auth/link/provider", { body: { providerId: provider.id } }),
        { sessionHandling: false },
      );
      globalThis.location.assign(started.url);
    });

  const confirmWithDirectory = (provider: Provider) =>
    run(provider.id, async () => {
      const result = await request(
        () =>
          api.POST("/api/v1/auth/link/directory", {
            body: { providerId: provider.id, password: directoryPassword },
          }),
        { sessionHandling: false },
      );
      setDirectoryPassword("");
      if (result.status === "signedIn") {
        await finish(result.sessionKind);
        return;
      }
      setDirectory(null);
      await pending.refetch();
    });

  const decline = async () => {
    setDeclining(true);
    setError(null);
    try {
      const result = await request(() => api.POST("/api/v1/auth/link/decline"), { sessionHandling: false });
      queryClient.removeQueries({ queryKey: linkQuery.queryKey });
      setReference(result.reference);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setDeclining(false);
    }
  };

  if (pending.isPending) {
    return (
      <AuthCard title={t("auth.link.loading")}>
        <Skeleton className="h-32 w-full" />
      </AuthCard>
    );
  }
  if (pending.isError) {
    return (
      <AuthCard title={t("auth.link.unavailableTitle")}>
        <LoadError what={t("failures.loadLink")} error={pending.error} onRetry={() => pending.refetch()} />
        <Link to="/sign-in" className="text-center font-medium text-accent hover:underline">
          {t("auth.link.backToSignIn")}
        </Link>
      </AuthCard>
    );
  }
  const data = pending.data;
  return (
    <AuthCard
      title={t("auth.link.title", { provider: data.providerName })}
      description={t("auth.link.description", { email: data.email ?? "" })}
    >
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface-sunken p-3">
        <KeyRound aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{data.providerName}</span>
          <span className="truncate text-sm text-text-muted">
            {t("auth.link.signedInAs", { email: data.email ?? "" })}
          </span>
        </div>
        <Badge variant="success" icon={BadgeCheck}>
          {t("auth.link.verified")}
        </Badge>
      </div>
      {error ? (
        <Notice variant="danger" title={t("failures.linkAccount")}>
          {error}
        </Notice>
      ) : null}
      {confirmed ? (
        <Notice variant="info" title={t("auth.link.confirmedTitle")}>
          {t("auth.link.confirmedDescription")}
        </Notice>
      ) : null}
      {withPassword || confirmed ? (
        <form className="flex flex-col gap-4" onSubmit={submitWith(submit)} noValidate>
          {withPassword ? (
            <Field
              label={t("auth.link.password", { name: data.accountName })}
              error={form.formState.errors.password?.message}
            >
              <PasswordInput autoComplete="current-password" autoFocus {...form.register("password")} />
            </Field>
          ) : null}
          {factors.length > 1 ? (
            <SegmentedControl
              label={t("auth.link.secondFactor")}
              value={active ?? "totp"}
              onValueChange={(value) => {
                setFactor(value as Factor);
                form.resetField("code");
              }}
              options={factors.map((value) => ({ value, label: t(`auth.link.factors.${value}`) }))}
            />
          ) : null}
          {active === "totp" || active === "recoveryCode" ? (
            <Field
              label={active === "totp" ? t("auth.authenticatorCode") : t("auth.recoveryCode")}
              error={form.formState.errors.code?.message}
            >
              <Input
                autoComplete="one-time-code"
                {...(active === "totp" ? { inputMode: "numeric" as const } : {})}
                {...form.register("code")}
              />
            </Field>
          ) : null}
          {active === "passkey" ? <Notice variant="info">{t("auth.link.passkeyHint")}</Notice> : null}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            {...(active === "passkey" ? { icon: Fingerprint } : {})}
            loading={form.formState.isSubmitting}
          >
            {t("auth.link.confirm")}
          </Button>
        </form>
      ) : null}
      {withPasskey || providers.length > 0 ? (
        <div className="flex flex-col gap-3">
          {withPassword ? (
            <p className="text-center text-sm text-text-muted">{t("auth.link.orConfirmWith")}</p>
          ) : (
            <p className="text-sm text-text-muted">{t("auth.link.confirmWith")}</p>
          )}
          {withPasskey ? (
            <Button
              variant="secondary"
              block
              icon={Fingerprint}
              loading={busy === "passkey"}
              onClick={() => void confirmWithPasskey()}
            >
              {t("auth.link.withPasskey")}
            </Button>
          ) : null}
          {providers.map((provider) =>
            provider.directory && directory?.id === provider.id ? (
              <form
                key={provider.id}
                className="flex flex-col gap-3 rounded-md border border-border p-3"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmWithDirectory(provider);
                }}
              >
                <Field label={t("auth.link.directoryPassword", { provider: provider.name })}>
                  <PasswordInput
                    autoComplete="current-password"
                    autoFocus
                    value={directoryPassword}
                    onChange={(event) => setDirectoryPassword(event.target.value)}
                  />
                </Field>
                <Button type="submit" variant="primary" block loading={busy === provider.id}>
                  {t("auth.link.confirm")}
                </Button>
              </form>
            ) : (
              <Button
                key={provider.id}
                variant="secondary"
                block
                icon={LogIn}
                loading={busy === provider.id}
                onClick={() =>
                  provider.directory ? setDirectory(provider) : void confirmWithProvider(provider)
                }
              >
                <span className="truncate" title={provider.name}>
                  {t("auth.link.withProvider", { provider: provider.name })}
                </span>
              </Button>
            ),
          )}
        </div>
      ) : null}
      <p className="text-sm text-text-muted">{t("auth.link.afterwards", { provider: data.providerName })}</p>
      <p className="text-center text-sm">
        <button
          type="button"
          className="font-medium text-text-muted hover:underline focus-visible:focus-ring"
          disabled={declining}
          onClick={() => void decline()}
        >
          {t("auth.link.notMine")}
        </button>
      </p>
      <Dialog
        open={reference !== null}
        onOpenChange={(open) => {
          if (!open) void navigate({ to: "/sign-in" });
        }}
        title={t("auth.link.notMineTitle")}
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p>{t("auth.link.notMineDescription", { provider: data.providerName })}</p>
          <p className="text-sm text-text-muted">
            {t("auth.link.notMineReference")} <span className="font-mono text-text">{reference}</span>
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void navigate({ to: "/sign-in" })}>
              {t("auth.link.backToSignIn")}
            </Button>
          </div>
        </div>
      </Dialog>
    </AuthCard>
  );
}
