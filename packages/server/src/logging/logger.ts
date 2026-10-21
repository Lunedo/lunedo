import { type DestinationStream, type Logger as PinoLogger, pino } from "pino";
import { currentRequestContext } from "../observability/request-context.js";

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

const DATABASE_ERROR_FIELDS = [
  "name",
  "code",
  "severity",
  "schema",
  "table",
  "column",
  "constraint",
  "routine",
];

function isFailedQuery(value: unknown): value is Error & { cause?: unknown } {
  return value instanceof Error && "query" in value && "params" in value;
}

function safeError(value: unknown): unknown {
  if (!isFailedQuery(value)) return value instanceof Error ? pino.stdSerializers.err(value) : value;
  const frames = (value.stack ?? "").split("\n").filter((line) => line.startsWith("    at "));
  const cause =
    typeof value.cause === "object" && value.cause !== null
      ? Object.fromEntries(
          DATABASE_ERROR_FIELDS.flatMap((field) => {
            const entry = (value.cause as Record<string, unknown>)[field];
            return typeof entry === "string" ? [[field, entry]] : [];
          }),
        )
      : undefined;
  return {
    type: value.constructor.name,
    message: "Failed query",
    stack: ["Error: Failed query", ...frames].join("\n"),
    ...(cause ? { cause } : {}),
  };
}

/**
 * Structured JSON logs on stdout. Credentials are redacted in case they reach a log call.
 * Lines written inside a request context carry its request ID.
 */
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
      serializers: { err: safeError, error: safeError },
      mixin: (_object, _level, logger) => {
        const context = currentRequestContext();
        if (!context || "requestId" in logger.bindings()) return {};
        return { requestId: context.requestId };
      },
    },
    options.destination,
  );
}
