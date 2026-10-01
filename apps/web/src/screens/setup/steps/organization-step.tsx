import { type Language, languageSchema, organizationNameSchema, timeZoneSchema } from "@pagehall/shared";
import { Button, Field, Input, Notice, Select } from "@pagehall/ui";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { problemMessage } from "../../../errors/problem-message.js";
import { browserTimeZone, timeZoneOptions } from "../../../format/time-zones.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../../forms/use-schema-form.js";
import { isLanguage, supportedLanguages } from "../../../i18n/index.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

const organizationForm = z.object({
  name: organizationNameSchema,
  language: languageSchema,
  timeZone: timeZoneSchema,
});

export function OrganizationStep({ details, back, onDone }: StepProps<"organization">) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const existing = details.organization;
  const form = useSchemaForm(organizationForm, {
    defaultValues: {
      name: existing?.name ?? "",
      language: existing?.language ?? (isLanguage(i18n.language) ? i18n.language : "en"),
      timeZone: existing?.timeZone ?? browserTimeZone(),
    },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await runSetupAction("organization", "save", values);
      await onDone();
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
      {error ? (
        <Notice variant="danger" title={t("failures.createOrganization")}>
          {error}
        </Notice>
      ) : null}
      <Field label={t("setup.organization.name")} error={form.formState.errors.name?.message}>
        <Input autoComplete="organization" autoFocus {...form.register("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("setup.organization.language")} error={form.formState.errors.language?.message}>
          <Controller
            control={form.control}
            name="language"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(value) => field.onChange(value as Language)}
                options={supportedLanguages.map((language) => ({
                  value: language,
                  label: t(`languages.${language}`),
                }))}
              />
            )}
          />
        </Field>
        <Field label={t("setup.organization.timeZone")} error={form.formState.errors.timeZone?.message}>
          <Controller
            control={form.control}
            name="timeZone"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} options={timeZoneOptions()} />
            )}
          />
        </Field>
      </div>
      <div className="flex justify-between gap-2">
        {back}
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {t("setup.continue")}
        </Button>
      </div>
    </form>
  );
}
