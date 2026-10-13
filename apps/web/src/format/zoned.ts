function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const local = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return Math.round((local - Math.floor(instant / 1000) * 1000) / 60_000);
}

export function zonedToInstant(date: string, time: string, timeZone: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return null;
  const local = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
  let instant = local - offsetMinutes(local, timeZone) * 60_000;
  instant = local - offsetMinutes(instant, timeZone) * 60_000;
  return new Date(instant);
}

export function instantToZoned(instant: string | Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

export function localDateInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function localTimeInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

export function instantInZone(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const local = `${localDateInZone(guess, timeZone)}T${localTimeInZone(guess, timeZone)}`;
    const offset = new Date(`${local}:00Z`).getTime() - guess.getTime();
    const candidate = new Date(new Date(`${date}T${time}:00Z`).getTime() - offset);
    if (candidate.getTime() === guess.getTime()) return candidate;
    guess.setTime(candidate.getTime());
  }
  return guess;
}

export function weekdayLabel(index: number, language: string, width: "long" | "short"): string {
  const monday = new Date(Date.UTC(2024, 0, 1, 12));
  const date = new Date(monday.getTime() + index * 86_400_000);
  return new Intl.DateTimeFormat(language, { weekday: width, timeZone: "UTC" }).format(date);
}

export function yearInZone(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).format(instant);
}

export function dayInZone(instant: Date, timeZone: string): string {
  return localDateInZone(instant, timeZone);
}
