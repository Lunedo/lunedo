import { DatePicker, type DatePickerProps, TimePicker } from "@lunedo/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createFormatter } from "../format/format.js";
import { useFormat } from "../preferences/preferences-provider.js";

export function AppDatePicker(props: Omit<DatePickerProps, "formatDate" | "locale" | "weekStart">) {
  const { i18n } = useTranslation();
  const format = useFormat();
  const calendar = useMemo(() => createFormatter({ ...format.settings, timeZone: "UTC" }), [format.settings]);
  return (
    <DatePicker
      {...props}
      formatDate={(date) => calendar.date(date)}
      locale={i18n.language}
      weekStart={format.firstDayOfWeek}
    />
  );
}

export function AppTimePicker(props: {
  value: string;
  onValueChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const { i18n } = useTranslation();
  const format = useFormat();
  return <TimePicker {...props} locale={i18n.language} hour12={format.settings.timeFormat === "12h"} />;
}
