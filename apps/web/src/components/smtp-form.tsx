import {
  emailSchema,
  type Language,
  type SmtpConfiguration,
  smtpConfigurationSchema,
  smtpSecurityModes,
} from "@pagehall/shared";
import { Button, ErrorState, Field, Input, Notice, PasswordInput, SegmentedControl } from "@pagehall/ui";
import { Send } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { problemMessage } from "../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../forms/use-schema-form.js";
import { isLanguage } from "../i18n/index.js";

const smtpForm = z
  .object({
    host: smtpConfigurationSchema.shape.host,
    port: z.coerce.number<string>().int().min(1).max(65_535),
    security: smtpConfigurationSchema.shape.security,
    username: z.string().max(256),
    password: z.string().max(1024),
    from: smtpConfigurationSchema.shape.from,
  })
  .refine((values) => values.security !== "none" || values.username === "", {
    path: ["username"],
    message: "credentials",
  });

type SmtpFormInput = z.input<typeof smtpForm>;

export interface SmtpInput extends SmtpConfiguration {
  password?: string | null;
}

export interface SmtpFormProps {
  initial: SmtpConfiguration | null;
  passwordSet: boolean;
  onSave: (input: SmtpInput) => Promise<void>;
  onTest: (input: SmtpInput & { to: string; language: Language }) => Promise<{
    delivered: boolean;
    error: { code: string | null; responseCode: number | null } | null;
  }>;
  defaultRecipient?: string;
  saveLabel: string;
  secondary?: ReactNode;
}

function toInput(values: z.output<typeof smtpForm>, passwordSet: boolean): SmtpInput {
  const username = values.username.trim() === "" ? null : values.username.trim();
  const password =
    username === null ? null : values.password !== "" ? values.password : passwordSet ? undefined : null;
  return {
    host: values.host,
    port: values.port,
    security: values.security,
    username,
    from: values.from,
    ...(password === undefined ? {} : { password }),
  };
}

export function SmtpForm({
  initial,
  passwordSet,
  onSave,
  onTest,
  defaultRecipient,
  saveLabel,
  secondary,
}: SmtpFormProps) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [testResult, setTestResult] = useState<{ delivered: boolean; detail: string | null } | null>(null);
  const [testing, setTesting] = useState(false);
  const form = useSchemaForm(smtpForm, {
    defaultValues: {
      host: initial?.host ?? "",
      port: String(initial?.port ?? 587),
      security: initial?.security ?? "starttls",
      username: initial?.username ?? "",
      password: "",
      from: initial?.from ?? "",
    } as SmtpFormInput,
    messages: { username: t("mail.credentialsNeedTls") },
  });

  const save = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSave(toInput(values, passwordSet));
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });

  const test = form.handleSubmit(async (values) => {
    setTestResult(null);
    if (!emailSchema.safeParse(recipient).success) {
      setTestResult({ delivered: false, detail: t("validation.email") });
      return;
    }
    setTesting(true);
    try {
      const result = await onTest({
        ...toInput(values, passwordSet),
        to: recipient,
        language: isLanguage(i18n.language) ? i18n.language : "en",
      });
      setTestResult({
        delivered: result.delivered,
        detail: result.error
          ? [result.error.code, result.error.responseCode].filter((part) => part !== null).join(" ")
          : null,
      });
    } catch (failure) {
      setTestResult({ delivered: false, detail: problemMessage(t, failure) });
    } finally {
      setTesting(false);
    }
  });

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(save)}>
      {error ? (
        <Notice variant="danger" title={t("failures.saveMail")}>
          {error}
        </Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <Field label={t("mail.host")} error={form.formState.errors.host?.message}>
            <Input autoComplete="off" {...form.register("host")} />
          </Field>
        </div>
        <Field label={t("mail.port")} error={form.formState.errors.port?.message}>
          <Input inputMode="numeric" autoComplete="off" {...form.register("port")} />
        </Field>
      </div>
      <Field label={t("mail.security")} hint={t("mail.securityHint")}>
        <Controller
          control={form.control}
          name="security"
          render={({ field }) => (
            <SegmentedControl
              label={t("mail.security")}
              value={field.value}
              onValueChange={field.onChange}
              options={smtpSecurityModes.map((mode) => ({
                value: mode,
                label: t(`mail.securityModes.${mode}`),
              }))}
            />
          )}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("mail.username")}
          hint={t("mail.usernameHint")}
          error={form.formState.errors.username?.message}
        >
          <Input autoComplete="off" {...form.register("username")} />
        </Field>
        <Field
          label={t("mail.password")}
          hint={passwordSet ? t("mail.passwordKept") : undefined}
          error={form.formState.errors.password?.message}
        >
          <PasswordInput autoComplete="new-password" {...form.register("password")} />
        </Field>
      </div>
      <Field label={t("mail.from")} error={form.formState.errors.from?.message}>
        <Input type="email" autoComplete="off" {...form.register("from")} />
      </Field>
      <div className="flex flex-col gap-3 rounded-md border border-border p-4">
        <Field label={t("mail.testRecipient")}>
          <Input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" icon={Send} loading={testing} onClick={() => void test()}>
            {t("mail.sendTest")}
          </Button>
          {testResult?.delivered ? (
            <span role="status" className="text-success">
              {t("mail.testDelivered")}
            </span>
          ) : null}
        </div>
        {testResult && !testResult.delivered ? (
          <ErrorState
            title={t("mail.testFailed")}
            cause={testResult.detail ?? t("mail.testFailedUnknown")}
            action={t("mail.testFailedAction")}
            onRetry={() => void test()}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        {secondary ?? <span />}
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {saveLabel}
        </Button>
      </div>
    </form>
  );
}
