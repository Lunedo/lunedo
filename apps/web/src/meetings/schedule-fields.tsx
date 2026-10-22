import { Checkbox, Field, Input, Select, TimeZoneCombobox } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { dayInZone } from "../format/zoned.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import {
  describeRhythm,
  RHYTHM_PRESETS,
  type RhythmChoice,
  rhythmFor,
  WEEKDAYS,
  weekdayName,
} from "./rhythm.js";

export interface ScheduleValue {
  choice: RhythmChoice;
  startsOn: string;
  startTime: string;
  timeZone: string;
  durationMinutes: string;
}

export type ScheduleErrors = Partial<
  Record<"startsOn" | "startTime" | "timeZone" | "durationMinutes" | "interval", string>
>;

export function defaultSchedule(timeZone: string, preset: RhythmChoice["preset"] = "weekly"): ScheduleValue {
  const tomorrow = new Date(Date.now() + 86_400_000);
  return {
    choice: { preset, interval: 2, weekdays: [] },
    startsOn: dayInZone(tomorrow, timeZone),
    startTime: "09:30",
    timeZone,
    durationMinutes: "45",
  };
}

export function validateSchedule(t: TFunction, value: ScheduleValue): ScheduleErrors {
  const errors: ScheduleErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.startsOn)) errors.startsOn = t("meetings.schedule.dateRequired");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.startTime))
    errors.startTime = t("meetings.schedule.timeRequired");
  if (!value.timeZone) errors.timeZone = t("meetings.schedule.timeZoneRequired");
  const minutes = Number(value.durationMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
    errors.durationMinutes = t("meetings.schedule.durationInvalid");
  }
  if (value.choice.preset === "everyNWeeks" && (value.choice.interval < 2 || value.choice.interval > 52)) {
    errors.interval = t("meetings.schedule.intervalInvalid");
  }
  return errors;
}

export function scheduleBody(value: ScheduleValue) {
  return {
    rhythm: rhythmFor(value.choice, value.startsOn),
    startsOn: value.startsOn,
    startTime: value.startTime,
    timeZone: value.timeZone,
    durationMinutes: Number(value.durationMinutes),
  };
}

export function ScheduleFields({
  value,
  onChange,
  errors,
  firstMeetingLabel,
}: {
  value: ScheduleValue;
  onChange: (value: ScheduleValue) => void;
  errors: ScheduleErrors;
  firstMeetingLabel?: string;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const set = (changes: Partial<ScheduleValue>) => onChange({ ...value, ...changes });
  const setChoice = (changes: Partial<RhythmChoice>) => set({ choice: { ...value.choice, ...changes } });
  const summary = /^\d{4}-\d{2}-\d{2}$/.test(value.startsOn)
    ? describeRhythm(t, rhythmFor(value.choice, value.startsOn), i18n.language)
    : null;
  return (
    <div className="flex flex-col gap-4">
      <Field label={t("meetings.schedule.rhythm")} hint={summary ?? undefined}>
        <Select
          value={value.choice.preset}
          onValueChange={(preset) => setChoice({ preset: preset as RhythmChoice["preset"] })}
          options={RHYTHM_PRESETS.map((preset) => ({
            value: preset,
            label: translateKey(t, `meetings.rhythm.presets.${preset}`),
          }))}
        />
      </Field>
      {value.choice.preset === "everyNWeeks" ? (
        <Field label={t("meetings.schedule.interval")} error={errors.interval}>
          <Input
            type="number"
            inputMode="numeric"
            min={2}
            max={52}
            value={String(value.choice.interval)}
            onChange={(event) => setChoice({ interval: Number(event.target.value) })}
          />
        </Field>
      ) : null}
      {value.choice.preset === "weekdays" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium">{t("meetings.schedule.weekdays")}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEKDAYS.map((day) => (
              <Checkbox
                key={day}
                label={weekdayName(day, i18n.language)}
                checked={value.choice.weekdays.includes(day)}
                onCheckedChange={(checked) =>
                  setChoice({
                    weekdays: checked
                      ? [...value.choice.weekdays, day]
                      : value.choice.weekdays.filter((candidate) => candidate !== day),
                  })
                }
              />
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={firstMeetingLabel ?? t("meetings.schedule.firstDate")} error={errors.startsOn} required>
          <Input
            type="date"
            value={value.startsOn}
            onChange={(event) => set({ startsOn: event.target.value })}
          />
        </Field>
        <Field label={t("meetings.schedule.time")} error={errors.startTime} required>
          <Input
            type="time"
            value={value.startTime}
            onChange={(event) => set({ startTime: event.target.value })}
          />
        </Field>
        <Field
          label={t("meetings.schedule.duration")}
          hint={t("meetings.schedule.durationHint")}
          error={errors.durationMinutes}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={5}
            max={1440}
            step={5}
            value={value.durationMinutes}
            onChange={(event) => set({ durationMinutes: event.target.value })}
          />
        </Field>
        <Field
          label={t("meetings.schedule.timeZone")}
          hint={t("meetings.schedule.timeZoneHint")}
          error={errors.timeZone}
        >
          <TimeZoneCombobox
            value={value.timeZone}
            locale={format.settings.language}
            onValueChange={(zone) => set({ timeZone: zone ?? "" })}
          />
        </Field>
      </div>
    </div>
  );
}
