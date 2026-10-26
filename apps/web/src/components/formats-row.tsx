import { SettingRow } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { type ReactNode, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { dateFormatLabel, timeFormatLabel, weekStartLabel } from "../settings/locale-options.js";

export const FORMAT_KEYS = [
  "locale.dateFormat",
  "locale.timeFormat",
  "locale.numberFormat",
  "locale.firstDayOfWeek",
] as const;

const SAMPLE_NUMBER = 1234.56;

export function formatsExample(
  t: TFunction,
  language: string,
  values: Partial<Record<(typeof FORMAT_KEYS)[number], unknown>>,
  now = new Date(),
): string {
  const parts = [
    typeof values["locale.dateFormat"] === "string"
      ? dateFormatLabel(t, values["locale.dateFormat"], language, now)
      : null,
    typeof values["locale.timeFormat"] === "string"
      ? timeFormatLabel(t, values["locale.timeFormat"], now)
      : null,
    typeof values["locale.numberFormat"] === "string"
      ? new Intl.NumberFormat(values["locale.numberFormat"], { minimumFractionDigits: 2 }).format(
          SAMPLE_NUMBER,
        )
      : null,
    typeof values["locale.firstDayOfWeek"] === "string"
      ? t("settings.formats.weekStartExample", { day: weekStartLabel(t, values["locale.firstDayOfWeek"]) })
      : null,
  ];
  return parts.filter((part): part is string => part !== null).join(" · ");
}

export function FormatsRow({
  example,
  meta,
  children,
}: {
  example: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <SettingRow
      label={t("settings.formats.label")}
      description={t("settings.formats.hint")}
      wide
      control={
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span data-formats-example="" className="min-w-0 tabular-nums">
            {example}
          </span>
          <button
            type="button"
            className="min-h-control-sm rounded-sm font-medium text-accent hover:underline focus-visible:focus-ring"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? t("settings.formats.close") : t("settings.formats.customize")}
          </button>
        </span>
      }
      {...(meta ? { meta } : {})}
      below={
        open ? (
          <div id={panelId} className="grid grid-cols-1 gap-x-4 gap-y-3 pt-1 sm:grid-cols-2">
            {children}
          </div>
        ) : null
      }
    />
  );
}

export function FormatCell({
  label,
  control,
  meta,
  menu,
  status,
}: {
  label: string;
  control: ReactNode;
  meta?: ReactNode;
  menu?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <div data-format-cell="" className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-control-sm items-center justify-between gap-2">
        <span className="text-sm text-text-muted">{label}</span>
        <span className="flex items-center gap-1">
          {meta}
          {menu}
        </span>
      </div>
      <div className="flex min-w-0">{control}</div>
      {status}
    </div>
  );
}
