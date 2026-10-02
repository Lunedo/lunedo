import { Field, Input, type SaveState, SaveStatus, Textarea } from "@pagehall/ui";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { isRetryable } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { issueMessage } from "../forms/validation.js";

export interface SaveTracker {
  state: SaveState;
  error: string | null;
  retryable: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  retry: () => void;
}

export function useSaveState(): SaveTracker {
  const { t } = useTranslation();
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const last = useRef<(() => Promise<unknown>) | null>(null);
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      last.current = action;
      setState("saving");
      setError(null);
      try {
        await action();
        setState("saved");
        return true;
      } catch (failure) {
        setError(problemMessage(t, failure));
        setRetryable(isRetryable(failure));
        setState("error");
        return false;
      }
    },
    [t],
  );
  const retry = useCallback(() => {
    if (last.current) void run(last.current);
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
  const actions = useRef<Record<string, () => Promise<unknown>>>({});
  const set = (key: string, snapshot: SaveSnapshot) =>
    setStates((current) => ({ ...current, [key]: snapshot }));
  const run = async (key: string, action: () => Promise<unknown>) => {
    actions.current[key] = action;
    set(key, { state: "saving", error: null, retryable: false });
    try {
      await action();
      set(key, { state: "saved", error: null, retryable: false });
      return true;
    } catch (failure) {
      set(key, { state: "error", error: problemMessage(t, failure), retryable: isRetryable(failure) });
      return false;
    }
  };
  return (key) => ({
    ...(states[key] ?? IDLE),
    run: (action) => run(key, action),
    retry: () => {
      const action = actions.current[key];
      if (action) void run(key, action);
    },
  });
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
  const { t } = useTranslation();
  const tracker = useSaveState();
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
    const ok = await tracker.run(() => onSave(next));
    if (ok) setSaved(next);
  };

  const fieldError =
    invalid ?? (tracker.state === "error" && tracker.error && !tracker.retryable ? tracker.error : undefined);
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
    <div className="flex flex-col gap-1">
      <Field label={label} {...(hint ? { hint } : {})} {...(fieldError ? { error: fieldError } : {})}>
        {control}
      </Field>
      {tracker.state === "error" && !tracker.retryable ? null : <SaveIndicator tracker={tracker} />}
    </div>
  );
}
