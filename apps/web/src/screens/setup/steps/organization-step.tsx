import {
  type Formats,
  formatsSchema,
  type Language,
  languageSchema,
  organizationNameSchema,
  proposeFormats,
  timeZoneSchema,
} from "@pagehall/shared";
import { Button, Combobox, Field, Input, Notice, Select, TimeZoneCombobox } from "@pagehall/ui";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { languageItems } from "../../../components/pickers.js";
import { problemMessage } from "../../../errors/problem-message.js";
import { browserTimeZone } from "../../../format/time-zones.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../../forms/use-schema-form.js";
import { isLanguage } from "../../../i18n/index.js";
import { translateKey } from "../../../i18n/translate.js";
import { localeOptionSet } from "../../../settings/locale-options.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

const organizationForm = z.object({
  name: organizationNameSchema,
  language: languageSchema,
  timeZone: timeZoneSchema,
  formats: formatsSchema,
});

const FORMAT_FIELDS: { name: keyof Formats; key: string; labelKey: string }[] = [
  { name: "dateFormat", key: "locale.dateFormat", labelKey: "preferences.dateFormat" },
  { name: "timeFormat", key: "locale.timeFormat", labelKey: "preferences.timeFormat" },
  { name: "numberFormat", key: "locale.numberFormat", labelKey: "preferences.numberFormat" },
  { name: "firstDayOfWeek", key: "locale.firstDayOfWeek", labelKey: "preferences.firstDayOfWeek" },
];

export function OrganizationStep({ details, back, onDone }: StepProps<"organization">) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const existing = details.organization;
  const language = existing?.language ?? (isLanguage(i18n.language) ? i18n.language : "en");
  const timeZone = existing?.timeZone ?? browserTimeZone();
  const form = useSchemaForm(organizationForm, {
    defaultValues: {
      name: existing?.name ?? "",
      language,
      timeZone,
      formats: details.formats ?? proposeFormats(language, timeZone),
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
              <Combobox
                aria-label={t("setup.organization.language")}
                value={field.value}
                onValueChange={(value) => {
                  if (value) field.onChange(value as Language);
                }}
                items={languageItems(t)}
              />
            )}
          />
        </Field>
        <Field label={t("setup.organization.timeZone")} error={form.formState.errors.timeZone?.message}>
          <Controller
            control={form.control}
            name="timeZone"
            render={({ field }) => (
              <TimeZoneCombobox
                aria-label={t("setup.organization.timeZone")}
                value={field.value}
                locale={i18n.language}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              />
            )}
          />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="font-medium text-text">{t("setup.organization.formats")}</legend>
        <p className="text-sm text-text-muted">{t("setup.organization.formatsHint")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {FORMAT_FIELDS.map((format) => (
            <Field key={format.name} label={translateKey(t, format.labelKey)}>
              <Controller
                control={form.control}
                name={`formats.${format.name}`}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    options={localeOptionSet(format.key)?.options(t, i18n.language) ?? []}
                  />
                )}
              />
            </Field>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-between gap-2">
        {back}
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {t("setup.continue")}
        </Button>
      </div>
    </form>
  );
}
