import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { from, type Observable, switchMap } from "rxjs";
import { z } from "zod";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { API_ROUTE, type ApiRouteDefinition } from "./api-route.js";
import { ProblemException } from "./problems.js";

export function toJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toJson(entry)]));
  }
  return value;
}

const emptyBody = z.union([z.undefined(), z.null(), z.object({}).strict()]);

function parse<T extends z.ZodType>(schema: T, value: unknown, location: string): z.output<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new ProblemException("invalidInput", `The request ${location} is not valid`, {
    fields: result.error.issues.map((issue) => [location, ...issue.path].join(".")),
  });
}

@Injectable()
export class ApiRouteInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(API_CONTEXT) private readonly context: ApiContext,
  ) {}

  intercept(execution: ExecutionContext, next: CallHandler): Observable<unknown> {
    const definition = this.reflector.get<ApiRouteDefinition | undefined>(API_ROUTE, execution.getHandler());
    if (!definition) return next.handle();
    const request = execution.switchToHttp().getRequest<FastifyRequest>();
    if (definition.params) request.params = parse(definition.params, request.params ?? {}, "params");
    if (definition.query) request.query = parse(definition.query, request.query ?? {}, "query");
    if (!definition.upload) request.body = parse(definition.body ?? emptyBody, request.body, "body");
    return next
      .handle()
      .pipe(switchMap((result: unknown) => from(this.#respond(definition, execution, result))));
  }

  async #respond(
    definition: ApiRouteDefinition,
    execution: ExecutionContext,
    result: unknown,
  ): Promise<unknown> {
    if (definition.raw) return result;
    if (execution.switchToHttp().getResponse<FastifyReply>().statusCode === 304) return undefined;
    if (!definition.response) return undefined;
    const parsed = definition.response.schema.safeParse(toJson(result));
    if (parsed.success) return parsed.data;
    this.context.logger.error(
      {
        handler: `${execution.getClass().name}.${execution.getHandler().name}`,
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      },
      "Response does not match its schema",
    );
    throw new ProblemException("internalError");
  }
}
