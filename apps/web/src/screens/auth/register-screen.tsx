import { signInEmailSchema } from "@pagehall/shared";
import { Button, Field, Input, Notice } from "@pagehall/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { AuthCard } from "./auth-layout.js";
import { BackToSignIn } from "./reset-password-screen.js";

const registerForm = z.object({ email: signInEmailSchema });

export function RegisterScreen() {
  const { t } = useTranslation();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(registerForm, { defaultValues: { email: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() => api.POST("/api/v1/registrations", { body: values }), { sessionHandling: false });
      setSent(true);
    } catch (failure) {
      setError(problemMessage(t, failure));
    }
  });
  return (
    <AuthCard title={t("auth.registerTitle")} description={sent ? undefined : t("auth.registerDescription")}>
      {sent ? (
        <Notice variant="success">{t("auth.registerSent")}</Notice>
      ) : (
        <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
          {error ? (
            <Notice variant="danger" title={t("failures.register")}>
              {error}
            </Notice>
          ) : null}
          <Field label={t("auth.workEmail")} error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="email" autoFocus {...form.register("email")} />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
            {t("auth.sendRegistrationLink")}
          </Button>
        </form>
      )}
      <BackToSignIn />
    </AuthCard>
  );
}
