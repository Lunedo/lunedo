import { instanceNameSchema, instanceUrlSchema } from "@lunedo/shared";
import { Button, Field, Input, Notice } from "@lunedo/ui";
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
      <Field
        label={t("setup.instance.url")}
        hint={
          details.urlFromEnvironment
            ? t("instance.general.addressFromEnvironment")
            : t("setup.instance.urlHint")
        }
        error={form.formState.errors.url?.message}
      >
        <Input
          type="url"
          autoComplete="url"
          readOnly={details.urlFromEnvironment}
          {...form.register("url")}
        />
      </Field>
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
