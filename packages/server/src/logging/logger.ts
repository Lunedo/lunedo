import { type DestinationStream, type Logger as PinoLogger, pino } from "pino";

export const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export type LogLevel = (typeof logLevels)[number];
export type Logger = PinoLogger;

const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  "password",
  "token",
  "secret",
  "*.password",
  "*.token",
  "*.secret",
];

/** Structured JSON logs on stdout. Credentials are redacted in case they reach a log call. */
export function createLogger(options: {
  service: string;
  level: LogLevel;
  destination?: DestinationStream;
}): Logger {
  return pino(
    {
      level: options.level,
      base: { service: options.service },
      messageKey: "message",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    },
    options.destination,
  );
}
