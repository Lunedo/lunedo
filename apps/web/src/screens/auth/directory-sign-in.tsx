import { passwordSchema } from "@lunedo/shared";
import { Button, Field, Input, Notice, PasswordInput } from "@lunedo/ui";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { type DirectorySignInResult, signInWithDirectory } from "../../api/identity-queries.js";
import { directoryProblemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";

export type DirectorySignInName = "email" | "userPrincipalName" | "sAMAccountName" | "uid";

export interface DirectoryTarget {
  providerId: string;
  name: string;
  signInName: DirectorySignInName | null;
  email: string | null;
}

const directoryForm = z.object({
  signInName: z.string().trim().min(1).max(256),
  password: passwordSchema,
});

export function initialSignInName(target: DirectoryTarget): string {
  const email = target.email ?? "";
  if (target.signInName === "email" || target.signInName === "userPrincipalName") return email;
  if (target.signInName === "sAMAccountName" || target.signInName === "uid") return email.split("@")[0] ?? "";
  return "";
}

type SecondFactor = "totp" | "passkey" | "recoveryCode";

export function secondFactors(factors: readonly string[]): SecondFactor[] {
  return factors.filter((factor): factor is SecondFactor =>
    ["totp", "passkey", "recoveryCode"].includes(factor),
  );
}

export function DirectorySignInForm({
  target,
  redirect,
  onSignedIn,
}: {
  target: DirectoryTarget;
  redirect: string | undefined;
  onSignedIn: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(directoryForm, {
    defaultValues: { signInName: initialSignInName(target), password: "" },
  });
  const asksForName = target.signInName !== "email";

  const finish = async (result: DirectorySignInResult) => {
    if (result.status === "signedIn") {
      await onSignedIn();
      return;
    }
    if (result.status === "secondFactorRequired") {
      await navigate({
        to: "/sign-in/verify",
        search: { factors: secondFactors(result.factors), ...(redirect ? { redirect } : {}) },
      });
      return;
    }
    if (result.status === "linkRequired") {
      await navigate({ to: "/sign-in/link" });
      return;
    }
    await navigate({
      to: "/sign-in/refused",
      search: { reference: result.reference, reason: result.reason },
    });
  };

  const submit = form.handleSubmit(async ({ signInName, password }) => {
    setError(null);
    try {
      await finish(await signInWithDirectory(target.providerId, { signInName, password }));
    } catch (failure) {
      setError(directoryProblemMessage(t, failure));
      form.resetField("password");
    }
  });

  return (
    <form className="flex flex-col gap-4" onSubmit={submitWith(submit)} noValidate>
      {error ? (
        <Notice variant="danger" title={t("auth.directory.failedTitle", { name: target.name })}>
          {error}
        </Notice>
      ) : null}
      {asksForName ? (
        <Field
          label={t("auth.directory.signInName", { name: target.name })}
          hint={t(`auth.directory.signInNameHints.${target.signInName ?? "unknown"}`)}
          error={form.formState.errors.signInName?.message}
        >
          <Input autoComplete="username" autoFocus {...form.register("signInName")} />
        </Field>
      ) : null}
      <Field
        label={t("auth.password")}
        hint={t("auth.directory.passwordHint")}
        error={form.formState.errors.password?.message}
      >
        <PasswordInput
          autoComplete="current-password"
          autoFocus={!asksForName}
          {...form.register("password")}
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" block loading={form.formState.isSubmitting}>
        {t("auth.signIn")}
      </Button>
    </form>
  );
}
