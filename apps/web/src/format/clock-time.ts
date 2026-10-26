export function clockTime(time: string, language: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(language, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
    Date.UTC(2000, 0, 1, hours, minutes),
  );
}

export function timeFormatSample(twelveHour: boolean, value: Date): string {
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    hour: twelveHour ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12: twelveHour,
  }).format(value);
}
