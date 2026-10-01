const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/OPR\/(\d+)/, "Opera"],
  [/Firefox\/(\d+)/, "Firefox"],
  [/FxiOS\/(\d+)/, "Firefox"],
  [/CriOS\/(\d+)/, "Chrome"],
  [/Chrome\/(\d+)/, "Chrome"],
  [/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//, "Safari"],
  [/^curl\/(\d+)/, "curl"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function describeUserAgent(userAgent: string): { browser: string | null; system: string | null } {
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent));
  const version = browser ? browser[0].exec(userAgent)?.[1] : undefined;
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent));
  return {
    browser: browser ? `${browser[1]}${version ? ` ${version}` : ""}` : null,
    system: system ? system[1] : null,
  };
}
