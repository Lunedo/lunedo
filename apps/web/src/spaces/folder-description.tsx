import { introductionText } from "@lunedo/shared";
import { Field, Textarea } from "@lunedo/ui";
import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SaveIndicator, useSaveState } from "../components/auto-save.js";
import { IntroductionPreview } from "../knowledge-bases/settings/introduction-editor.js";

export function folderDescriptionText(value: string, formatted: boolean): string {
  return formatted ? introductionText(value) : value;
}

export function ReadOnlyFolderDescription({ value, formatted }: { value: string; formatted: boolean }) {
  if (value === "") return null;
  return formatted ? (
    <div className="text-text-muted">
      <IntroductionPreview source={value} />
    </div>
  ) : (
    <p className="text-text-muted">{value}</p>
  );
}

export function FolderDescription({
  value,
  onSave,
  formatted = false,
}: {
  value: string;
  onSave: (value: string) => Promise<unknown>;
  formatted?: boolean;
}) {
  const { t } = useTranslation();
  const tracker = useSaveState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const area = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);

  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => opener.current?.focus());
  };

  const commit = async () => {
    const next = draft.trim();
    if (next === value) {
      close();
      return;
    }
    if (await tracker.run(() => onSave(next))) close();
  };

  if (!editing) {
    const shown = folderDescriptionText(value, formatted);
    return (
      <div className="flex flex-col gap-1">
        <button
          ref={opener}
          type="button"
          {...(value === "" ? {} : { "aria-label": t("folder.editDescription", { description: shown }) })}
          className="group -mx-2 inline-flex items-baseline gap-2 self-start rounded-md px-2 py-1 text-start whitespace-pre-wrap hover:bg-hover focus-visible:focus-ring"
          onClick={() => setEditing(true)}
        >
          {value === "" ? (
            <span className="text-text-muted">{t("folder.addDescription")}</span>
          ) : (
            <span className="text-text-muted">{shown}</span>
          )}
          <Pencil
            aria-hidden="true"
            className="size-icon-sm shrink-0 text-text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
        {tracker.state === "saved" ? <SaveIndicator tracker={tracker} /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Field
        label={t("folder.description")}
        hint={t("createItem.descriptionHint")}
        {...(tracker.state === "error" && tracker.error ? { error: tracker.error } : {})}
      >
        <Textarea
          ref={area}
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(value);
              close();
            }
          }}
        />
      </Field>
      {tracker.state === "saving" ? <SaveIndicator tracker={tracker} /> : null}
    </div>
  );
}
