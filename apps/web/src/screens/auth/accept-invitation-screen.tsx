import { accountNameSchema, passwordSchema } from "@pagehall/shared";
import { Button, Field, Input, Notice, PasswordInput } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { instanceInfoQuery } from "../../api/queries.js";
import { isApiError, request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useLinkToken } from "../../session/link-token.js";
import { AuthCard } from "./auth-layout.js";

const detailsForm = z
  .object({ name: accountNameSchema, password: passwordSchema, repeated: z.string() })
  .refine((values) => values.password === values.repeated, { path: ["repeated"], message: "mismatch" });

type State = "start" | "details" | "joined" | "created";

export function AcceptInvitationScreen() {
  const { t } = useTranslation();
  const token = useLinkToken();
  const info = useQuery(instanceInfoQuery);
  const [state, setState] = useState<State>("start");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useSchemaForm(detailsForm, {
    defaultValues: { name: "", password: "", repeated: "" },
    messages: { repeated: t("auth.passwordsDiffer") },
  });

  if (!token) {
    return (
      <AuthCard title={t("auth.invitationTitle")}>
        <Notice variant="danger">{t("problems.invalidToken")}</Notice>
      </AuthCard>
    );
  }

  const accept = async (details: { name?: string; password?: string } = {}) => {
    setError(null);
    setBusy(true);
    try {
      const result = await request(
        () => api.POST("/api/v1/invitations/accept", { body: { token, ...details } }),
        { sessionHandling: false },
      );
      setState(result.accountCreated ? "created" : "joined");
    } catch (failure) {
      if (isApiError(failure, "accountDetailsRequired")) setState("details");
      else setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t("auth.invitationTitle")} description={t("auth.invitationDescription")}>
      {error ? (
        <Notice variant="danger" title={t("failures.acceptInvitation")}>
          {error}
        </Notice>
      ) : null}
      {state === "start" ? (
        <Button variant="primary" size="lg" block loading={busy} onClick={() => void accept()}>
          {t("auth.acceptInvitation")}
        </Button>
      ) : null}
      {state === "details" ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={submitWith(
            form.handleSubmit((values) => accept({ name: values.name, password: values.password })),
          )}
        >
          <Notice variant="info">{t("auth.createAccountForInvitation")}</Notice>
          <Field label={t("auth.name")} error={form.formState.errors.name?.message}>
            <Input autoComplete="name" autoFocus {...form.register("name")} />
          </Field>
          <Field
            label={t("auth.password")}
            hint={t("auth.passwordHint", { minimum: info.data?.passwordMinLength ?? 12 })}
            error={form.formState.errors.password?.message}
          >
            <PasswordInput autoComplete="new-password" {...form.register("password")} />
          </Field>
          <Field label={t("auth.repeatPassword")} error={form.formState.errors.repeated?.message}>
            <PasswordInput autoComplete="new-password" {...form.register("repeated")} />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {t("auth.createAccount")}
          </Button>
        </form>
      ) : null}
      {state === "joined" || state === "created" ? (
        <>
          <Notice variant="success">
            {state === "created" ? t("auth.invitationAccountCreated") : t("auth.invitationJoined")}
          </Notice>
          <Button variant="primary" block asChild>
            <Link to="/sign-in">{t("auth.signIn")}</Link>
          </Button>
        </>
      ) : null}
    </AuthCard>
  );
}
