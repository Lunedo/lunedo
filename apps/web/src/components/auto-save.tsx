import {
  Button,
  Field,
  FieldError,
  focusFirstInvalidSoon,
  Input,
  PasswordInput,
  type SaveState,
  SaveStatus,
  SettingRow,
  Textarea,
  useToast,
} from "@lunedo/ui";
import { useCallback, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { isRetryable } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { issueMessage } from "../forms/validation.js";

export class FieldProblem extends Error {
  override name = "FieldProblem";
}

function failureMessage(t: Parameters<typeof problemMessage>[0], failure: unknown): string {
  return failure instanceof FieldProblem ? failure.message : problemMessage(t, failure);
}

export interface SaveTracker {
  state: SaveState;
  error: string | null;
  retryable: boolean;
  run: (action: () => Promise<unknown>, onSaved?: () => void) => Promise<boolean>;
  retry: () => void;
}

export function useSaveState(): SaveTracker {
  const { t } = useTranslation();
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const last = useRef<{ action: () => Promise<unknown>; onSaved: (() => void) | undefined } | null>(null);
  const run = useCallback(
    async (action: () => Promise<unknown>, onSaved?: () => void) => {
      last.current = { action, onSaved };
      setState("saving");
      setError(null);
      try {
        await action();
        setState(onSaved ? "idle" : "saved");
        onSaved?.();
        return true;
      } catch (failure) {
        setError(failureMessage(t, failure));
        setRetryable(isRetryable(failure));
        setState("error");
        return false;
      }
    },
    [t],
  );
  const retry = useCallback(() => {
    if (last.current) void run(last.current.action, last.current.onSaved);
  }, [run]);
  return { state, error, retryable, run, retry };
}

interface SaveSnapshot {
  state: SaveState;
  error: string | null;
  retryable: boolean;
}

const IDLE: SaveSnapshot = { state: "idle", error: null, retryable: false };

export function useSaveStates(): (key: string) => SaveTracker {
  const { t } = useTranslation();
  const [states, setStates] = useState<Record<string, SaveSnapshot>>({});
  const actions = useRef<Record<string, { action: () => Promise<unknown>; onSaved: (() => void) | undefined }>>(
    {},
  );
  const set = (key: string, snapshot: SaveSnapshot) =>
    setStates((current) => ({ ...current, [key]: snapshot }));
  const run = async (key: string, action: () => Promise<unknown>, onSaved?: () => void) => {
    actions.current[key] = { action, onSaved };
    set(key, { state: "saving", error: null, retryable: false });
    try {
      await action();
      set(key, { state: onSaved ? "idle" : "saved", error: null, retryable: false });
      onSaved?.();
      return true;
    } catch (failure) {
      set(key, { state: "error", error: problemMessage(t, failure), retryable: isRetryable(failure) });
      return false;
    }
  };
  return (key) => ({
    ...(states[key] ?? IDLE),
    run: (action, onSaved) => run(key, action, onSaved),
    retry: () => {
      const last = actions.current[key];
      if (last) void run(key, last.action, last.onSaved);
    },
  });
}

export function useUndoToast() {
  const { t } = useTranslation();
  const { toast } = useToast();
  return useCallback(
    (label: string, revert: () => Promise<unknown>) => {
      toast({
        title: t("settings.savedNamed", { name: label }),
        undo: {
          onUndo: () => {
            revert().then(
              () => toast({ title: t("settings.undone", { name: label }) }),
              (failure: unknown) =>
                toast({
                  variant: "error",
                  title: t("settings.undoFailed", { name: label }),
                  description: problemMessage(t, failure),
                }),
            );
          },
        },
      });
    },
    [t, toast],
  );
}

export function SaveIndicator({ tracker }: { tracker: SaveTracker }) {
  return (
    <SaveStatus
      state={tracker.state}
      {...(tracker.error ? { error: tracker.error } : {})}
      {...(tracker.retryable ? { onRetry: tracker.retry } : {})}
    />
  );
}

function useAutoSaveText({
  label,
  value,
  schema,
  onSave,
  multiline,
  invalidMessage,
}: {
  value: string;
  schema: z.ZodType<string> | undefined;
  onSave: (value: string) => Promise<unknown>;
  multiline: boolean;
  invalidMessage: string | undefined;
  label: string;
}) {
  const { t } = useTranslation();
  const tracker = useSaveState();
  const undoToast = useUndoToast();
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [invalid, setInvalid] = useState<string | null>(null);
  if (saved !== value && draft === saved) {
    setDraft(value);
    setSaved(value);
  }

  const commit = async () => {
    const next = multiline ? draft : draft.trim();
    if (next === saved) {
      setInvalid(null);
      return;
    }
    if (schema) {
      const parsed = schema.safeParse(next);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        setInvalid(issue ? issueMessage(t, issue, invalidMessage) : t("validation.invalid"));
        return;
      }
    }
    setInvalid(null);
    const previous = saved;
    await tracker.run(
      () => onSave(next),
      () => {
        setSaved(next);
        undoToast(label, async () => {
          await onSave(previous);
          setSaved(previous);
          setDraft(previous);
        });
      },
    );
  };

  const fieldError =
    invalid ?? (tracker.state === "error" && tracker.error && !tracker.retryable ? tracker.error : undefined);
  return { tracker, draft, setDraft, commit, fieldError };
}

export function AutoSaveTextField({
  label,
  hint,
  value,
  schema,
  onSave,
  disabled = false,
  multiline = false,
  className,
  invalidMessage,
}: {
  invalidMessage?: string;
  label: string;
  hint?: string;
  value: string;
  schema?: z.ZodType<string>;
  onSave: (value: string) => Promise<unknown>;
  disabled?: boolean;
  multiline?: boolean;
  className?: string;
}) {
  const { tracker, draft, setDraft, commit, fieldError } = useAutoSaveText({
    label,
    value,
    schema,
    onSave,
    multiline,
    invalidMessage,
  });
  const control = multiline ? (
    <Textarea
      rows={2}
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      {...(className ? { className } : {})}
    />
  ) : (
    <Input
      value={draft}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        }
      }}
      {...(className ? { className } : {})}
    />
  );
  return (
    <Field
      label={label}
      {...(hint ? { hint } : {})}
      {...(fieldError ? { error: fieldError } : {})}
      {...(tracker.state === "error" && !tracker.retryable
        ? {}
        : { labelAction: <SaveIndicator tracker={tracker} /> })}
    >
      {control}
    </Field>
  );
}

export function AutoSaveTextRow({
  label,
  hint,
  value,
  schema,
  onSave,
  disabled = false,
  invalidMessage,
  maxLength,
}: {
  label: string;
  hint?: string;
  value: string;
  schema?: z.ZodType<string>;
  onSave: (value: string) => Promise<unknown>;
  disabled?: boolean;
  invalidMessage?: string;
  maxLength?: number;
}) {
  const id = useId();
  const { tracker, draft, setDraft, commit, fieldError } = useAutoSaveText({
    label,
    value,
    schema,
    onSave,
    multiline: false,
    invalidMessage,
  });
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [fieldError ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");
  return (
    <SettingRow
      label={<label htmlFor={id}>{label}</label>}
      control={
        <Input
          id={id}
          value={draft}
          disabled={disabled}
          invalid={Boolean(fieldError)}
          {...(describedBy ? { "aria-describedby": describedBy } : {})}
          {...(maxLength ? { maxLength } : {})}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
          }}
        />
      }
      {...(hint ? { description: <span id={hintId}>{hint}</span> } : {})}
      {...(fieldError ? { error: <FieldError id={errorId}>{fieldError}</FieldError> } : {})}
      status={
        tracker.state === "error" && !tracker.retryable ? undefined : <SaveIndicator tracker={tracker} />
      }
    />
  );
}

export function ExplicitSaveTextField({
  label,
  hint,
  value,
  schema,
  invalidMessage,
  onSave,
  disabled = false,
  className,
  secret,
}: {
  label: string;
  hint?: string;
  value: string;
  schema?: z.ZodType<string>;
  invalidMessage?: string;
  onSave: (value: string, secret: string) => Promise<unknown>;
  disabled?: boolean;
  className?: string;
  secret?: { label: string; hint: string };
}) {
  const { t } = useTranslation();
  const tracker = useSaveState();
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(value);
  const [secretValue, setSecretValue] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [secretMissing, setSecretMissing] = useState(false);
  if (saved !== value && draft === saved) {
    setDraft(value);
    setSaved(value);
  }
  const changed = draft.trim() !== saved;

  const save = async () => {
    const next = draft.trim();
    if (schema) {
      const parsed = schema.safeParse(next);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        setInvalid(issue ? issueMessage(t, issue, invalidMessage) : t("validation.invalid"));
        focusFirstInvalidSoon();
        return;
      }
    }
    setInvalid(null);
    if (secret && secretValue === "") {
      setSecretMissing(true);
      focusFirstInvalidSoon();
      return;
    }
    setSecretMissing(false);
    if (await tracker.run(() => onSave(next, secretValue))) {
      setSaved(next);
      setDraft(next);
      setSecretValue("");
    } else {
      focusFirstInvalidSoon();
    }
  };
  const cancel = () => {
    setDraft(saved);
    setSecretValue("");
    setInvalid(null);
    setSecretMissing(false);
  };

  const fieldError = invalid ?? (tracker.state === "error" && tracker.error ? tracker.error : undefined);
  return (
    <div className="flex flex-col gap-2">
      <Field label={label} {...(hint ? { hint } : {})} {...(fieldError ? { error: fieldError } : {})}>
        <Input
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void save();
            }
            if (event.key === "Escape") cancel();
          }}
          {...(className ? { className } : {})}
        />
      </Field>
      {changed && secret ? (
        <Field
          label={secret.label}
          hint={secret.hint}
          {...(secretMissing ? { error: t("validation.required") } : {})}
        >
          <PasswordInput
            autoComplete="off"
            value={secretValue}
            onChange={(event) => setSecretValue(event.target.value)}
          />
        </Field>
      ) : null}
      {changed ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={tracker.state === "saving"}
            onClick={() => void save()}
          >
            {t("common.save")}
          </Button>
        </div>
      ) : tracker.state === "saved" ? (
        <SaveIndicator tracker={tracker} />
      ) : null}
    </div>
  );
}
