import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject } from "@nestjs/common";
import {
  AuthError,
  BackupBusyError,
  BackupNotFoundError,
  BackupSettingsError,
  BusyError,
  ChatChannelError,
  CommentInvalidError,
  DiagramRejectedError,
  DocumentInvalidError,
  EmailInUseError,
  ExportBusyError,
  ExportError,
  FileTooLargeError,
  ForbiddenError,
  ImportError,
  OrganizationError,
  PasswordPolicyError,
  ProviderResponseError,
  PushSubscriptionError,
  RelyingPartyError,
  SanitizerBusyError,
  SavedSearchLimitError,
  SavedSearchNameError,
  SceneInvalidError,
  type SceneProblemCode,
  SessionGoneError,
  SettingAboveMaximumError,
  SettingBelowMinimumError,
  SettingError,
  SettingLockedError,
  SetupNotFoundError,
  SetupStepError,
  ShareLinkRateLimitedError,
  SmtpConfigurationError,
  SpaceError,
  StorageFullError,
  StorageSettingsError,
  SvgRejectedError,
  TokenRejectedError,
  UploadTimeoutError,
} from "@pagehall/server";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { API_CONTEXT, type ApiContext } from "../context.js";
import {
  forbiddenProblem,
  isProblemCode,
  type ProblemCode,
  ProblemException,
  problemBody,
} from "./problems.js";

const SCENE_PROBLEM_MESSAGES: Record<SceneProblemCode, string> = {
  notAnObject: "Expected an object",
  notSerializable: "The scene is not valid JSON",
  tooLarge: "The scene is larger than allowed",
  tooManyElements: "The scene has too many elements",
  tooManyFiles: "The scene has too many images",
  elementTooLarge: "The element is larger than allowed",
  unknownElementType: "This kind of element is not supported",
  unknownField: "The field is not supported",
  invalidElement: "The element has a value that is not allowed",
  duplicateElement: "Two elements have the same ID",
  invalidLink: "Links can point to http and https addresses and to Pagehall only",
  invalidFile: "Images must be attachments of the same page or whiteboard",
};

const STATUS_CODES: Record<number, ProblemCode> = {
  400: "invalidInput",
  401: "notSignedIn",
  403: "forbidden",
  404: "notFound",
  405: "methodNotAllowed",
  413: "payloadTooLarge",
  415: "unsupportedMediaType",
  429: "rateLimited",
  503: "busy",
};

export function sendProblem(
  reply: FastifyReply,
  code: ProblemCode,
  detail?: string,
  extensions: Record<string, unknown> = {},
) {
  const body = problemBody(code, detail, extensions);
  return reply.status(body.status).type("application/problem+json").send(body);
}

export function problemForStatus(status: number): ProblemCode {
  return STATUS_CODES[status] ?? (status >= 500 ? "internalError" : "invalidInput");
}

const NOT_FOUND_CODES = new Set([
  "spaceNotFound",
  "itemNotFound",
  "commentNotFound",
  "taskNotFound",
  "seriesNotFound",
  "meetingNotFound",
  "topicNotFound",
]);

function codeOf(code: string, fallback: ProblemCode): ProblemCode {
  return isProblemCode(code) ? code : fallback;
}

interface Mapped {
  code: ProblemCode;
  detail?: string;
  extensions?: Record<string, unknown>;
}

function zodFields(error: ZodError): string[] {
  return error.issues.map((issue) => issue.path.join("."));
}

function map(error: unknown): Mapped | null {
  if (error instanceof ProblemException) {
    const body = error.getResponse() as { detail?: string };
    return {
      code: error.code,
      ...(body.detail ? { detail: body.detail } : {}),
      extensions: error.extensions,
    };
  }
  if (error instanceof SetupNotFoundError) return { code: "notFound" };
  if (error instanceof TokenRejectedError) return { code: "invalidApiToken", detail: error.message };
  if (error instanceof AuthError) {
    return {
      code: codeOf(error.code, "invalidInput"),
      detail: error.message,
      ...(error.retryAfterSeconds !== undefined
        ? { extensions: { retryAfterSeconds: error.retryAfterSeconds } }
        : {}),
    };
  }
  if (error instanceof PasswordPolicyError) {
    return {
      code: "passwordPolicy",
      detail: error.message,
      extensions: { problem: error.problem, minLength: error.minLength },
    };
  }
  if (error instanceof EmailInUseError) return { code: "emailInUse", detail: error.message };
  if (error instanceof ProviderResponseError) return { code: "providerUnavailable", detail: error.message };
  if (error instanceof BusyError) return { code: "busy", detail: error.message };
  if (error instanceof UploadTimeoutError) return { code: "uploadTimeout", detail: error.message };
  if (error instanceof SanitizerBusyError) {
    return {
      code: "busy",
      detail: error.message,
      extensions: { retryAfterSeconds: error.retryAfterSeconds },
    };
  }
  if (error instanceof SessionGoneError) return { code: "sessionEnded", detail: error.message };
  if (error instanceof RelyingPartyError) return { code: "instanceUrlMissing", detail: error.message };
  if (error instanceof SmtpConfigurationError)
    return { code: "invalidSmtpConfiguration", detail: error.message };
  if (error instanceof FileTooLargeError) {
    return {
      code: "fileTooLarge",
      detail: `The file is larger than ${Math.round(error.limit / 1024 / 1024)} MB`,
      extensions: { maxBytes: error.limit },
    };
  }
  if (error instanceof ShareLinkRateLimitedError) {
    return {
      code: "rateLimited",
      detail: "Too many attempts to open this link",
      extensions: { retryAfterSeconds: error.retryAfterSeconds },
    };
  }
  if (error instanceof ForbiddenError) {
    const problem = forbiddenProblem(error.decision.denials);
    return {
      code: problem.code,
      detail: (problem.getResponse() as { detail?: string }).detail ?? "Not allowed",
      extensions: problem.extensions,
    };
  }
  if (error instanceof StorageFullError) {
    return { code: "storageFull", detail: error.message, extensions: { refusal: error.refusal } };
  }
  if (error instanceof StorageSettingsError) {
    return {
      code: "invalidStorageSettings",
      detail: error.message,
      extensions: { fields: error.fields.map((field) => `body.${field}`), problem: error.code },
    };
  }
  if (error instanceof BackupSettingsError) {
    return {
      code: "invalidBackupSettings",
      detail: error.message,
      extensions: { fields: error.fields.map((field) => `body.${field}`), problem: error.code },
    };
  }
  if (error instanceof BackupBusyError) {
    return { code: "backupRunning", detail: error.message, extensions: { problem: error.what } };
  }
  if (error instanceof BackupNotFoundError) {
    return { code: "backupNotFound", detail: error.message };
  }
  if (error instanceof ExportBusyError) {
    return {
      code: "busy",
      detail: error.message,
      extensions: { retryAfterSeconds: error.retryAfterSeconds },
    };
  }
  if (error instanceof ExportError) {
    return { code: error.code === "exportNotFound" ? "notFound" : error.code, detail: error.message };
  }
  if (error instanceof OrganizationError)
    return { code: codeOf(error.code, "invalidInput"), detail: error.message, extensions: error.details };
  if (error instanceof ImportError) {
    const code = ["importNotFound", "uploadNotFound", "confluenceLinkNotFound"].includes(error.code)
      ? "notFound"
      : error.code;
    return { code: codeOf(code, "invalidInput"), detail: error.message, extensions: error.details };
  }
  if (error instanceof ChatChannelError) {
    const codes = {
      channelNotFound: "notFound",
      invalidChannel: "invalidChatChannel",
      invalidAddress: "invalidChatAddress",
      blockedAddress: "chatAddressBlocked",
      insecureAddress: "chatAddressInsecure",
      confidentialSpace: "confidentialSpace",
      tooManyChannels: "tooManyChatChannels",
    } as const;
    return {
      code: codes[error.code],
      detail: error.message,
      extensions: {
        ...(error.field ? { fields: [`body.${error.field}`] } : {}),
        ...(error.problem ? { problem: error.problem } : {}),
      },
    };
  }
  if (error instanceof PushSubscriptionError) {
    const codes = {
      invalidSubscription: "invalidPushSubscription",
      pushDisabled: "pushDisabled",
      tooManyDevices: "tooManyPushDevices",
    } as const;
    return { code: codes[error.code], detail: error.message };
  }
  if (error instanceof SpaceError) {
    const code = NOT_FOUND_CODES.has(error.code) ? "notFound" : error.code;
    return { code: codeOf(code, "invalidInput"), detail: error.message, extensions: error.details };
  }
  if (error instanceof CommentInvalidError) {
    return {
      code: "invalidComment",
      detail: error.message,
      extensions: { problems: error.problems.slice(0, 50) },
    };
  }
  if (error instanceof SceneInvalidError) {
    return {
      code: "invalidScene",
      detail: error.message,
      extensions: {
        problems: error.problems
          .slice(0, 50)
          .map((problem) => ({ ...problem, message: SCENE_PROBLEM_MESSAGES[problem.code] })),
      },
    };
  }
  if (error instanceof SvgRejectedError) return { code: "invalidDrawingImage", detail: error.message };
  if (error instanceof DiagramRejectedError) return { code: "invalidDiagram", detail: error.message };
  if (error instanceof DocumentInvalidError) {
    return {
      code: "invalidDocument",
      detail: error.message,
      extensions: { problems: error.problems.slice(0, 50) },
    };
  }
  if (error instanceof SettingBelowMinimumError) {
    return { code: "settingBelowMinimum", detail: error.message, extensions: { minimum: error.minimum } };
  }
  if (error instanceof SettingAboveMaximumError) {
    return { code: "settingAboveMaximum", detail: error.message, extensions: { maximum: error.maximum } };
  }
  if (error instanceof SettingLockedError) {
    return { code: "settingLocked", detail: error.message, extensions: { lockedBy: error.lockedBy.level } };
  }
  if (error instanceof SettingError) return { code: "invalidSetting", detail: error.message };
  if (error instanceof SavedSearchLimitError) return { code: "tooManySavedSearches", detail: error.message };
  if (error instanceof SavedSearchNameError) return { code: "invalidInput", detail: error.message };
  if (error instanceof ZodError) {
    return {
      code: "invalidInput",
      detail: "The request is not valid",
      extensions: { fields: zodFields(error) },
    };
  }
  if (error instanceof SetupStepError)
    return { code: codeOf(error.code, "setupNotReady"), detail: error.message };
  if (error instanceof HttpException) return { code: problemForStatus(error.getStatus()) };
  const status = error instanceof Error ? (error as { statusCode?: unknown }).statusCode : undefined;
  if (typeof status === "number" && status >= 400 && status < 500) return { code: problemForStatus(status) };
  return null;
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const mapped = map(error);
    if (!mapped) {
      this.context.logger.error({ err: error }, "Request failed");
      void sendProblem(reply, "internalError");
      return;
    }
    const retryAfter = mapped.extensions?.retryAfterSeconds;
    if (typeof retryAfter === "number") reply.header("retry-after", String(retryAfter));
    if (error instanceof BusyError) reply.header("retry-after", "1");
    void sendProblem(reply, mapped.code, mapped.detail, mapped.extensions);
  }
}
