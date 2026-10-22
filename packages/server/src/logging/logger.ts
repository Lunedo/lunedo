import { type DestinationStream, type Logger as PinoLogger, pino } from "pino";
import { currentRequestContext } from "../observability/request-context.js";

export const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

export type LogLevel = (typeof logLevels)[number];
export type Logger = PinoLogger;

export interface LoggedError {
  type: string;
  code: string | null;
}

export const OTHER_ERROR_TYPE = "Other error";

const SAFE_TYPE = /^[A-Z][A-Za-z ,'-]{2,79}$/;
const SAFE_CODE = /^[A-Za-z0-9_]{2,40}$/;
const ERROR_LEVEL = 50;

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

function codeOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const error = (value as { err?: unknown; error?: unknown }).err ?? (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, name } = error as { code?: unknown; name?: unknown };
  for (const candidate of [code, name]) {
    if (typeof candidate === "string" && SAFE_CODE.test(candidate)) return candidate;
  }
  return null;
}

export function loggedErrorOf(args: readonly unknown[]): LoggedError {
  const message = args.find((arg): arg is string => typeof arg === "string");
  return {
    type: message !== undefined && SAFE_TYPE.test(message) ? message : OTHER_ERROR_TYPE,
    code: codeOf(args[0]),
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
  onError?: (error: LoggedError) => void;
}): Logger {
  const { onError } = options;
  return pino(
    {
      level: options.level,
      base: { service: options.service },
      messageKey: "message",
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
      serializers: { err: safeError, error: safeError },
      ...(onError
        ? {
            hooks: {
              logMethod(args, method, level) {
                if (level >= ERROR_LEVEL) onError(loggedErrorOf(args));
                method.apply(this, args);
              },
            },
          }
        : {}),
      mixin: (_object, _level, logger) => {
        const context = currentRequestContext();
        if (!context || "requestId" in logger.bindings()) return {};
        return { requestId: context.requestId };
      },
    },
    options.destination,
  );
}
