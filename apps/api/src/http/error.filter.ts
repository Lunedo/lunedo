import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject } from "@nestjs/common";
import {
  AuthError,
  BusyError,
  EmailInUseError,
  ForbiddenError,
  OrganizationError,
  PasswordPolicyError,
  RelyingPartyError,
  SessionGoneError,
  SettingError,
  SettingLockedError,
  SetupNotFoundError,
  SetupStepError,
  SmtpConfigurationError,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { API_CONTEXT, type ApiContext } from "../context.js";

const AUTH_STATUS: Record<string, number> = {
  invalidCredentials: 401,
  invalidSecondFactor: 401,
  challengeExpired: 401,
  locked: 429,
  rateLimited: 429,
  setupIncomplete: 409,
  invalidToken: 400,
  lastSecondFactor: 409,
  noSecondFactor: 409,
  secondFactorExists: 409,
  sameEmail: 400,
};

const SETUP_STATUS: Record<string, number> = {
  invalidSetupCode: 401,
  unknownSetupAction: 404,
  invalidInput: 400,
  setupNotReady: 409,
  invalidSecondFactor: 400,
};

const ORGANIZATION_STATUS: Record<string, number> = {
  notFound: 404,
  roleNotFound: 404,
  groupNotFound: 404,
  slugTaken: 409,
  domainTaken: 409,
  roleNameTaken: 409,
  groupNameTaken: 409,
  alreadyMember: 409,
  alreadyAssigned: 409,
  lastOwner: 409,
  homeOrganization: 409,
  deactivateSelf: 409,
  instanceOwner: 409,
};

interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  [key: string]: unknown;
}

export function notFoundBody(request: FastifyRequest): Record<string, unknown> {
  return { message: `Cannot ${request.method} ${request.url}`, error: "Not Found", statusCode: 404 };
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if (error instanceof SetupNotFoundError) {
      void reply.status(404).send(notFoundBody(request));
      return;
    }
    if (error instanceof HttpException) {
      const response = error.getResponse();
      void reply
        .status(error.getStatus())
        .send(typeof response === "object" ? response : { message: response });
      return;
    }
    const body = this.#body(error);
    if (!body) {
      this.context.logger.error({ err: error }, "Request failed");
      void reply
        .status(500)
        .send({ statusCode: 500, code: "internalError", message: "Internal server error" });
      return;
    }
    if (error instanceof AuthError && error.retryAfterSeconds !== undefined) {
      reply.header("retry-after", String(error.retryAfterSeconds));
    }
    if (error instanceof BusyError) reply.header("retry-after", "1");
    void reply.status(body.statusCode).send(body);
  }

  #body(error: unknown): ErrorBody | null {
    if (error instanceof AuthError) {
      return {
        statusCode: AUTH_STATUS[error.code] ?? 400,
        code: error.code,
        message: error.message,
        ...(error.retryAfterSeconds !== undefined ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
      };
    }
    if (error instanceof PasswordPolicyError) {
      return {
        statusCode: 400,
        code: "passwordPolicy",
        message: error.message,
        problem: error.problem,
        minLength: error.minLength,
      };
    }
    if (error instanceof EmailInUseError)
      return { statusCode: 409, code: "emailInUse", message: error.message };
    if (error instanceof BusyError) return { statusCode: 503, code: "busy", message: error.message };
    if (error instanceof SessionGoneError)
      return { statusCode: 401, code: "sessionEnded", message: error.message };
    if (error instanceof RelyingPartyError) {
      return { statusCode: 409, code: "instanceUrlMissing", message: error.message };
    }
    if (error instanceof SmtpConfigurationError) {
      return { statusCode: 400, code: "invalidSmtpConfiguration", message: error.message };
    }
    if (error instanceof ForbiddenError) {
      return { statusCode: 403, code: "forbidden", message: "Not allowed", denials: error.decision.denials };
    }
    if (error instanceof OrganizationError) {
      return { statusCode: ORGANIZATION_STATUS[error.code] ?? 400, code: error.code, message: error.message };
    }
    if (error instanceof SettingLockedError) {
      return {
        statusCode: 409,
        code: "settingLocked",
        message: error.message,
        lockedBy: error.lockedBy.level,
      };
    }
    if (error instanceof SettingError)
      return { statusCode: 400, code: "invalidSetting", message: error.message };
    if (error instanceof ZodError) {
      return {
        statusCode: 400,
        code: "invalidInput",
        message: "The request is not valid",
        fields: error.issues.map((issue) => issue.path.join(".")),
      };
    }
    if (error instanceof SetupStepError) {
      return { statusCode: SETUP_STATUS[error.code] ?? 409, code: error.code, message: error.message };
    }
    return null;
  }
}
