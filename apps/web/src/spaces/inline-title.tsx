import { useToast } from "@pagehall/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../errors/problem-message.js";

export function InlineTitle({
  value,
  label,
  onSave,
  autoFocus = false,
}: {
  value: string;
  label: string;
  onSave: (value: string) => Promise<unknown>;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [editing, setEditing] = useState(autoFocus);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const commit = async () => {
    const next = draft.replace(/\s+/g, " ").trim();
    if (next === "" || next === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch (error) {
      toast({ title: t("pageTitle.saveFailed"), description: problemMessage(t, error), variant: "error" });
      input.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="-mx-1 rounded-sm px-1 text-start hover:bg-hover focus-visible:focus-ring"
        aria-label={t("pageTitle.edit", { title: value })}
        onClick={() => setEditing(true)}
      >
        {value}
      </button>
    );
  }
  return (
    <input
      ref={input}
      aria-label={label}
      value={draft}
      maxLength={255}
      aria-busy={saving}
      className="-mx-1 w-full rounded-sm bg-transparent px-1 outline-none focus-visible:focus-ring"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}
