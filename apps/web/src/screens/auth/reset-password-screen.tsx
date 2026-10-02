import { passwordSchema, signInEmailSchema } from "@pagehall/shared";
import { Button, Field, Input, Notice, PasswordInput } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { instanceInfoQuery } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useLinkToken } from "../../session/link-token.js";
import { AuthCard } from "./auth-layout.js";

const requestForm = z.object({ email: signInEmailSchema });
const newPasswordForm = z
  .object({ password: passwordSchema, repeated: z.string() })
  .refine((values) => values.password === values.repeated, { path: ["repeated"], message: "mismatch" });

export function ResetPasswordScreen() {
  const token = useLinkToken();
  return token ? <NewPassword token={token} /> : <RequestReset />;
}

function RequestReset() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(requestForm, { defaultValues: { email: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() => api.POST("/api/v1/auth/password-reset", { body: values }), {
        sessionHandling: false,
      });
      setSent(true);
    } catch (failure) {
      setError(problemMessage(t, failure));
    }
  });
  return (
    <AuthCard title={t("auth.resetTitle")} description={sent ? undefined : t("auth.resetDescription")}>
      {sent ? (
        <Notice variant="success">{t("auth.resetSent")}</Notice>
      ) : (
        <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
          {error ? (
            <Notice variant="danger" title={t("failures.requestReset")}>
              {error}
            </Notice>
          ) : null}
          <Field label={t("auth.email")} error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="username" autoFocus {...form.register("email")} />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
            {t("auth.sendResetLink")}
          </Button>
        </form>
      )}
      <BackToSignIn />
    </AuthCard>
  );
}

function NewPassword({ token }: { token: string }) {
  const { t } = useTranslation();
  const info = useQuery(instanceInfoQuery);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(newPasswordForm, {
    defaultValues: { password: "", repeated: "" },
    messages: { repeated: t("auth.passwordsDiffer") },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(
        () =>
          api.POST("/api/v1/auth/password-reset/complete", { body: { token, password: values.password } }),
        { sessionHandling: false },
      );
      setDone(true);
    } catch (failure) {
      setError(problemMessage(t, failure));
    }
  });
  return (
    <AuthCard title={t("auth.newPasswordTitle")}>
      {done ? (
        <>
          <Notice variant="success">{t("auth.passwordChanged")}</Notice>
          <Button variant="primary" block asChild>
            <Link to="/sign-in">{t("auth.signIn")}</Link>
          </Button>
        </>
      ) : (
        <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
          {error ? (
            <Notice variant="danger" title={t("failures.resetPassword")}>
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
          <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
            {t("auth.setPassword")}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function BackToSignIn() {
  const { t } = useTranslation();
  return (
    <Link to="/sign-in" className="self-center text-sm text-text-muted hover:text-text">
      {t("auth.backToSignIn")}
    </Link>
  );
}
