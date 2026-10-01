export type DurationUnit = "minutes" | "hours" | "days";

export const DURATION_UNITS: readonly DurationUnit[] = ["minutes", "hours", "days"];

export const MINUTES_PER_UNIT: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440 };

const INTL_UNIT: Record<DurationUnit, "minute" | "hour" | "day"> = {
  minutes: "minute",
  hours: "hour",
  days: "day",
};

export interface DurationParts {
  amount: number;
  unit: DurationUnit;
}

export function splitDuration(
  minutes: number,
  units: readonly DurationUnit[] = DURATION_UNITS,
): DurationParts {
  const allowed = DURATION_UNITS.filter((unit) => units.includes(unit));
  const largestFirst = [...allowed].reverse();
  const exact = largestFirst.find((unit) => minutes % MINUTES_PER_UNIT[unit] === 0 && minutes > 0);
  const unit = exact ?? allowed[0] ?? "minutes";
  return { amount: Math.round(minutes / MINUTES_PER_UNIT[unit]), unit };
}

export function joinDuration({ amount, unit }: DurationParts): number {
  return amount * MINUTES_PER_UNIT[unit];
}

export function formatDurationPart(amount: number, unit: DurationUnit, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: "unit", unit: INTL_UNIT[unit], unitDisplay: "long" }).format(
    amount,
  );
}

export function formatDuration(minutes: number, locale?: string): string {
  const total = Math.max(0, Math.round(minutes));
  if (total === 0) return formatDurationPart(0, "minutes", locale);
  const parts: [number, DurationUnit][] = [
    [Math.floor(total / MINUTES_PER_UNIT.days), "days"],
    [Math.floor((total % MINUTES_PER_UNIT.days) / MINUTES_PER_UNIT.hours), "hours"],
    [total % MINUTES_PER_UNIT.hours, "minutes"],
  ];
  return new Intl.ListFormat(locale, { type: "unit", style: "long" }).format(
    parts.filter(([amount]) => amount > 0).map(([amount, unit]) => formatDurationPart(amount, unit, locale)),
  );
}
