import { passwordSchema, signInEmailSchema } from "@pagehall/shared";
import { Button, Field, Input, Notice, PasswordInput } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { instanceInfoQuery, queryKeys } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { getPasskeyAssertion, isPasskeyCancelled, passkeysSupported } from "../../session/passkeys.js";
import { safeRedirect } from "../../session/redirect.js";
import { AuthCard } from "./auth-layout.js";

const route = getRouteApi("/public/sign-in");

const signInForm = z.object({ email: signInEmailSchema, password: passwordSchema });

export function SignInScreen() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const info = useQuery(instanceInfoQuery);
  const [error, setError] = useState<string | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const form = useSchemaForm(signInForm, { defaultValues: { email: "", password: "" } });
  const name = info.data?.organization?.name ?? info.data?.name ?? "";

  const signedIn = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    await navigate({ href: safeRedirect(search.redirect) });
  };

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const result = await request(() => api.POST("/api/v1/auth/sign-in", { body: values }), {
        sessionHandling: false,
      });
      if (result.status === "secondFactorRequired") {
        await navigate({
          to: "/sign-in/verify",
          search: {
            factors: result.factors.filter((factor): factor is "totp" | "passkey" | "recoveryCode" =>
              ["totp", "passkey", "recoveryCode"].includes(factor),
            ),
            ...(search.redirect ? { redirect: search.redirect } : {}),
          },
        });
        return;
      }
      await signedIn();
    } catch (failure) {
      setError(problemMessage(t, failure));
      form.resetField("password");
    }
  });

  const signInWithPasskey = async () => {
    setError(null);
    setPasskeyBusy(true);
    try {
      const options = await request(() => api.POST("/api/v1/auth/sign-in/passkey-options"), {
        sessionHandling: false,
      });
      const response = await getPasskeyAssertion(options);
      await request(
        () => api.POST("/api/v1/auth/sign-in/passkey", { body: { response: response as never } }),
        {
          sessionHandling: false,
        },
      );
      await signedIn();
    } catch (failure) {
      setError(isPasskeyCancelled(failure) ? t("auth.passkeyCancelled") : problemMessage(t, failure));
    } finally {
      setPasskeyBusy(false);
    }
  };

  return (
    <AuthCard title={t("auth.signInTitle", { name })} description={globalThis.location?.host}>
      {search.reason === "sessionEnded" ? <Notice variant="info">{t("auth.sessionEnded")}</Notice> : null}
      {error ? (
        <Notice variant="danger" title={t("auth.signInFailed")}>
          {error}
        </Notice>
      ) : null}
      {passkeysSupported() ? (
        <>
          <Button
            variant="outline"
            size="lg"
            block
            icon={Fingerprint}
            loading={passkeyBusy}
            onClick={() => void signInWithPasskey()}
          >
            {t("auth.signInWithPasskey")}
          </Button>
          <div className="flex items-center gap-3 text-sm text-text-muted">
            <span className="flex-1 border-border border-t" aria-hidden="true" />
            {t("auth.orWithPassword")}
            <span className="flex-1 border-border border-t" aria-hidden="true" />
          </div>
        </>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={submitWith(submit)} noValidate>
        <Field label={t("auth.email")} error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="username" autoFocus {...form.register("email")} />
        </Field>
        <Field label={t("auth.password")} error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register("password")} />
        </Field>
        <div className="-mt-2 flex justify-end text-sm">
          <Link to="/reset-password" className="font-medium text-accent hover:underline">
            {t("auth.forgotPassword")}
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
          {t("auth.signIn")}
        </Button>
      </form>
    </AuthCard>
  );
}
