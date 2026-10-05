import { totpCodeSchema } from "@pagehall/shared";
import { Button, Field, Notice, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../forms/use-schema-form.js";
import { CodeInput } from "./code-input.js";
import { QrCode } from "./qr-code.js";

const codeForm = z.object({ code: totpCodeSchema.min(1) });

export interface TotpEnrollmentProps {
  queryKey: readonly unknown[];
  begin: () => Promise<{ secret: string; uri: string }>;
  confirm: (code: string) => Promise<void>;
  submitLabel?: string;
}

export function formatSecret(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export function TotpEnrollment({ queryKey, begin, confirm, submitLabel }: TotpEnrollmentProps) {
  const { t } = useTranslation();
  const setup = useQuery({
    queryKey,
    queryFn: begin,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    throwOnError: false,
  });
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(codeForm, { defaultValues: { code: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await confirm(values.code.replace(/\s/g, ""));
    } catch (failure) {
      setError(problemMessage(t, failure));
      form.resetField("code");
    }
  });

  if (setup.isError)
    return (
      <LoadError
        what={t("failures.loadAuthenticatorSetup")}
        error={setup.error}
        onRetry={() => setup.refetch()}
      />
    );

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
      <div className="flex flex-wrap items-start gap-4">
        {setup.data ? (
          <QrCode value={setup.data.uri} label={t("security.totpQrCode")} />
        ) : (
          <Skeleton className="size-qr" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="font-medium">{t("security.totpScan")}</p>
          <p className="text-sm text-text-muted">{t("security.totpManual")}</p>
          {setup.data ? (
            <code className="rounded-sm bg-surface-sunken px-2 py-1 font-mono text-sm">
              {formatSecret(setup.data.secret)}
            </code>
          ) : null}
        </div>
      </div>
      {error ? (
        <Notice variant="danger" title={t("failures.addAuthenticator")}>
          {error}
        </Notice>
      ) : null}
      <Field
        label={t("auth.authenticatorCode")}
        hint={t("auth.authenticatorCodeHint")}
        error={form.formState.errors.code?.message}
      >
        <CodeInput control={form.control} name="code" />
      </Field>
      <Button type="submit" variant="primary" loading={form.formState.isSubmitting} disabled={!setup.data}>
        {submitLabel ?? t("security.totpConfirm")}
      </Button>
    </form>
  );
}
