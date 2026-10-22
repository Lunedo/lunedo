import { applyDecorators, HttpCode, SetMetadata } from "@nestjs/common";
import type { z } from "zod";
import type { ProblemCode } from "./problems.js";

export interface ApiResponse {
  description: string;
  schema: z.ZodType;
  example?: unknown;
}

export interface RawResponse {
  contentTypes: string[];
  description: string;
  example: string;
  ranges?: boolean;
}

export interface ApiRouteDefinition {
  summary: string;
  description?: string;
  tags: string[];
  status?: 200 | 201 | 202 | 204;
  redirect?: { description: string };
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  bodyExample?: unknown;
  upload?: { contentTypes: string[]; description: string };
  response?: ApiResponse;
  raw?: RawResponse;
  errors?: ProblemCode[];
}

export const API_ROUTE = "lunedo:api-route";

export function successStatus(definition: ApiRouteDefinition): number {
  if (definition.redirect) return 303;
  return definition.status ?? (definition.response || definition.raw ? 200 : 204);
}

export function ApiRoute(definition: ApiRouteDefinition) {
  return applyDecorators(SetMetadata(API_ROUTE, definition), HttpCode(successStatus(definition)));
}
