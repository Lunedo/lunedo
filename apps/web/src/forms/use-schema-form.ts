import { toNestErrors } from "@hookform/resolvers";
import { useCallback } from "react";
import {
  type DefaultValues,
  type FieldErrors,
  type FieldValues,
  type Path,
  type Resolver,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { isApiError } from "../api/request.js";
import { type FieldMessages, issueMessage, issuePath } from "./validation.js";

export function schemaResolver<TInput extends FieldValues, TOutput>(
  schema: z.ZodType<TOutput, TInput>,
  message: (issue: z.core.$ZodIssue) => string,
): Resolver<TInput, unknown, TOutput> {
  return async (values, _context, options) => {
    const result = await schema.safeParseAsync(values);
    if (result.success) return { values: result.data, errors: {} };
    const flat: Record<string, { type: string; message: string }> = {};
    for (const issue of result.error.issues) {
      const path = issuePath(issue);
      if (!flat[path]) flat[path] = { type: issue.code, message: message(issue) };
    }
    return { values: {}, errors: toNestErrors(flat as FieldErrors, options) };
  };
}

export interface SchemaFormOptions<TInput extends FieldValues> {
  defaultValues?: DefaultValues<TInput>;
  messages?: FieldMessages;
}

export function useSchemaForm<TInput extends FieldValues, TOutput>(
  schema: z.ZodType<TOutput, TInput>,
  options: SchemaFormOptions<TInput> = {},
): UseFormReturn<TInput, unknown, TOutput> {
  const { t } = useTranslation();
  const messages = options.messages;
  const message = useCallback(
    (issue: z.core.$ZodIssue) => issueMessage(t, issue, messages?.[issuePath(issue)]),
    [t, messages],
  );
  return useForm<TInput, unknown, TOutput>({
    resolver: schemaResolver(schema, message),
    mode: "onTouched",
    ...(options.defaultValues ? { defaultValues: options.defaultValues } : {}),
  });
}

export function submitWith<T>(handler: (event?: T) => Promise<void>): (event: T) => void {
  return (event) => {
    void handler(event);
  };
}

export function applyServerFieldErrors<TInput extends FieldValues>(
  form: UseFormReturn<TInput, unknown, unknown>,
  error: unknown,
  message: string,
): boolean {
  if (!isApiError(error, "invalidInput") || error.fields.length === 0) return false;
  const names = Object.keys(form.getValues());
  let applied = false;
  for (const field of error.fields) {
    const path = field.replace(/^(body|query|params)\./, "");
    if (names.includes(path.split(".")[0] ?? "")) {
      form.setError(path as Path<TInput>, { type: "server", message });
      applied = true;
    }
  }
  return applied;
}
