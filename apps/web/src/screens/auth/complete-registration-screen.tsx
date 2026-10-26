import { accountNameSchema, passwordSchema } from "@lunedo/shared";
import { Button, Field, Input, Notice, PasswordInput } from "@lunedo/ui";
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

const completeForm = z
  .object({ name: accountNameSchema, password: passwordSchema, repeated: z.string() })
  .refine((values) => values.password === values.repeated, { path: ["repeated"], message: "mismatch" });

export function CompleteRegistrationScreen() {
  const { t } = useTranslation();
  const token = useLinkToken();
  const info = useQuery(instanceInfoQuery);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(completeForm, {
    defaultValues: { name: "", password: "", repeated: "" },
    messages: { repeated: t("auth.passwordsDiffer") },
  });
  if (!token) {
    return (
      <AuthCard title={t("auth.completeRegistrationTitle")}>
        <Notice variant="danger">{t("problems.invalidToken")}</Notice>
      </AuthCard>
    );
  }
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(
        () =>
          api.POST("/api/v1/registrations/complete", {
            body: { token, name: values.name, password: values.password },
          }),
        { sessionHandling: false },
      );
      setDone(true);
    } catch (failure) {
      setError(problemMessage(t, failure));
    }
  });
  return (
    <AuthCard title={t("auth.completeRegistrationTitle")}>
      {done ? (
        <>
          <Notice variant="success">{t("auth.registrationComplete")}</Notice>
          <Button variant="primary" block asChild>
            <Link to="/sign-in">{t("auth.signIn")}</Link>
          </Button>
        </>
      ) : (
        <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
          {error ? (
            <Notice variant="danger" title={t("failures.completeRegistration")}>
              {error}
            </Notice>
          ) : null}
          <Field label={t("auth.name")} error={form.formState.errors.name?.message}>
            <Input autoComplete="name" autoFocus {...form.register("name")} />
          </Field>
          <Field
            label={t("auth.password")}
            hint={t("auth.passwordHint", { minimum: info.data?.passwordMinLength ?? 12 })}
            help={t("auth.passwordHelp", { minimum: info.data?.passwordMinLength ?? 12 })}
            error={form.formState.errors.password?.message}
          >
            <PasswordInput autoComplete="new-password" {...form.register("password")} />
          </Field>
          <Field label={t("auth.repeatPassword")} error={form.formState.errors.repeated?.message}>
            <PasswordInput autoComplete="new-password" {...form.register("repeated")} />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
            {t("auth.createAccount")}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
