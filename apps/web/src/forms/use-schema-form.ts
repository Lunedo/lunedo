import { toNestErrors } from "@hookform/resolvers";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef } from "react";
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
import { ApiError } from "../api/request.js";
import { registerUnsavedChanges } from "../app-update/app-update.js";
import { problemMessage } from "../errors/problem-message.js";
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
  const { t, i18n } = useTranslation();
  const messages = options.messages;
  const message = useCallback(
    (issue: z.core.$ZodIssue) => issueMessage(t, issue, messages?.[issuePath(issue)]),
    [t, messages],
  );
  const form = useForm<TInput, unknown, TOutput>({
    resolver: schemaResolver(schema, message),
    mode: "onSubmit",
    reValidateMode: "onChange",
    ...(options.defaultValues ? { defaultValues: options.defaultValues } : {}),
  });
  const dirty = useRef(false);
  dirty.current = form.formState.isDirty && !form.formState.isSubmitSuccessful;
  useEffect(() => registerUnsavedChanges(() => dirty.current), []);
  const language = useRef(i18n.language);
  useEffect(() => {
    if (language.current === i18n.language) return;
    language.current = i18n.language;
    const shown = Object.entries(form.formState.errors)
      .filter(([, error]) => error && error.type !== "server")
      .map(([name]) => name as Path<TInput>);
    if (shown.length > 0) void form.trigger(shown);
  }, [i18n.language, form]);
  return form;
}

export function submitWith<T>(handler: (event?: T) => Promise<void>): (event: T) => void {
  return (event) => {
    void handler(event);
  };
}

export function serverFieldErrors(t: TFunction, error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.fields.length === 0) return {};
  const message = error.code === "invalidInput" ? t("validation.invalid") : problemMessage(t, error);
  return Object.fromEntries(
    error.fields.map((field) => [field.replace(/^(body|query|params)\./, ""), message] as const),
  );
}

export function applyServerFieldErrors<TInput extends FieldValues>(
  form: UseFormReturn<TInput, unknown, unknown>,
  t: TFunction,
  error: unknown,
): boolean {
  const names = Object.keys(form.getValues());
  let applied = false;
  for (const [path, message] of Object.entries(serverFieldErrors(t, error))) {
    if (names.includes(path.split(".")[0] ?? "")) {
      form.setError(path as Path<TInput>, { type: "server", message }, { shouldFocus: !applied });
      applied = true;
    }
  }
  return applied;
}
