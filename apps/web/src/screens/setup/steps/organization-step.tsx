import {
  type Formats,
  formatsSchema,
  type Language,
  languageSchema,
  organizationNameSchema,
  proposeFormats,
  timeZoneSchema,
} from "@lunedo/shared";
import { Button, Combobox, Field, Input, Notice, Select, TimeZoneCombobox } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { languageItems } from "../../../components/pickers.js";
import { problemMessage } from "../../../errors/problem-message.js";
import { createFormatter } from "../../../format/format.js";
import { browserTimeZone, timeZoneName } from "../../../format/time-zones.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../../forms/use-schema-form.js";
import { isLanguage } from "../../../i18n/index.js";
import { translateKey } from "../../../i18n/translate.js";
import { localeOptionSet, weekStartLabel } from "../../../settings/locale-options.js";
import { runSetupAction } from "../setup-api.js";
import { useDraftDefaults, useKeepDraft } from "../setup-drafts.js";
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

export function formatsSuggestion(
  formats: Formats,
  language: string,
  t: TFunction,
  now = new Date(),
): string {
  const sample = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 14, 30));
  const format = createFormatter({ ...formats, language, timeZone: "UTC" });
  return [
    format.date(sample),
    format.time(sample),
    new Intl.NumberFormat(formats.numberFormat, { minimumFractionDigits: 2 }).format(1234.56),
    weekStartLabel(t, formats.firstDayOfWeek),
  ].join(" · ");
}

export function OrganizationStep({ details, back, onDone }: StepProps<"organization">) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [formatsOpen, setFormatsOpen] = useState(false);
  const zoneLabel = useCallback((zone: string, now: Date) => timeZoneName(t, zone, now), [t]);
  const existing = details.organization;
  const language = existing?.language ?? (isLanguage(i18n.language) ? i18n.language : "en");
  const timeZone = existing?.timeZone ?? browserTimeZone();
  const form = useSchemaForm(organizationForm, {
    defaultValues: useDraftDefaults("organization", {
      name: existing?.name ?? "",
      language,
      timeZone,
      formats: details.formats ?? proposeFormats(language, timeZone),
    }),
  });
  useKeepDraft("organization", form);
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await runSetupAction("organization", "save", values);
      await onDone();
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
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
                zoneLabel={zoneLabel}
                onValueChange={(value) => {
                  if (value) field.onChange(value);
                }}
              />
            )}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          aria-expanded={formatsOpen}
          aria-controls="setup-formats"
          className="inline-flex min-h-hit items-center gap-1 self-start rounded-sm text-left font-medium text-accent text-sm hover:underline focus-visible:focus-ring"
          onClick={() => setFormatsOpen((open) => !open)}
        >
          {formatsOpen ? (
            <ChevronDown aria-hidden="true" className="size-icon-sm shrink-0" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0" />
          )}
          {t("setup.organization.formatsSuggested", {
            formats: formatsSuggestion(form.watch("formats"), i18n.language, t),
          })}
        </button>
        {formatsOpen ? (
          <fieldset id="setup-formats" className="flex flex-col gap-3">
            <legend className="sr-only">{t("setup.organization.formats")}</legend>
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
        ) : null}
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
