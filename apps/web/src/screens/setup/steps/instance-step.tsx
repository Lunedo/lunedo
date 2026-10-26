import { instanceNameSchema, instanceUrlSchema } from "@lunedo/shared";
import { Button, Field, Icon, Input, Notice } from "@lunedo/ui";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { problemMessage } from "../../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../../forms/use-schema-form.js";
import { runSetupAction } from "../setup-api.js";
import { useDraftDefaults, useKeepDraft } from "../setup-drafts.js";
import type { StepProps } from "./step-props.js";

const instanceForm = z.object({ url: instanceUrlSchema, name: instanceNameSchema });

export function InstanceStep({ details, back, onDone }: StepProps<"instance">) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(instanceForm, {
    defaultValues: useDraftDefaults("instance", {
      url:
        (details.urlFromEnvironment ? details.suggestedUrl : details.url || details.suggestedUrl) ||
        globalThis.location?.origin ||
        "",
      name: details.name,
    }),
    messages: { url: t("validation.instanceUrl") },
  });
  useKeepDraft("instance", form);
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await runSetupAction("instance", "save", values);
      await onDone();
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
    }
  });
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
      {error ? (
        <Notice variant="danger" title={t("failures.saveInstance")}>
          {error}
        </Notice>
      ) : null}
      {details.urlFromEnvironment ? (
        <LockedAddress url={details.suggestedUrl ?? details.url} />
      ) : (
        <Field
          label={t("setup.instance.url")}
          hint={t("setup.instance.urlHint")}
          help={t("setup.instance.urlHelp")}
          error={form.formState.errors.url?.message}
        >
          <Input type="url" autoComplete="url" {...form.register("url")} />
        </Field>
      )}
      <Field label={t("setup.instance.name")} error={form.formState.errors.name?.message}>
        <Input autoComplete="off" {...form.register("name")} />
      </Field>
      <div className="flex justify-between gap-2">
        {back}
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {t("setup.continue")}
        </Button>
      </div>
    </form>
  );
}

export function LockedAddress({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-sm">{t("setup.instance.url")}</span>
      <p className="flex min-w-0 items-center gap-2">
        <Icon icon={Lock} size="sm" className="text-text-muted" />
        <span className="sr-only">{t("setup.instance.locked")}</span>
        <span className="min-w-0 break-all">{url}</span>
      </p>
      <p className="text-sm text-text-muted">
        {t("instance.general.addressFromEnvironment")} {t("instance.general.addressFromEnvironmentHelp")}
      </p>
    </div>
  );
}
