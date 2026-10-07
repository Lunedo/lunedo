import { Button, Checkbox, IconButton, Input } from "@pagehall/ui";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { findKey } from "./extensions/find-replace.js";

export function FindBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const find = useEditorState({ editor, selector: ({ editor: current }) => findKey.getState(current.state) });
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    editor.commands.setFindQuery(query, caseSensitive);
  }, [editor, query, caseSensitive]);
  const close = () => {
    editor.commands.clearFind();
    onClose();
    editor.commands.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };
  const total = find?.matches.length ?? 0;
  const status = query
    ? total === 0
      ? t("editor.find.none")
      : t("editor.find.count", { current: (find?.current ?? 0) + 1, total })
    : "";
  return (
    <search
      aria-label={t("editor.find.label")}
      className="ph-find-bar flex flex-wrap items-center gap-2 border-t border-border pt-2"
      onKeyDown={onKeyDown}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Input
          ref={input}
          aria-label={t("editor.find.query")}
          placeholder={t("editor.find.queryPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) editor.commands.findPrevious();
              else editor.commands.findNext();
            }
          }}
        />
        <span role="status" aria-live="polite" className="min-w-field shrink-0 text-sm text-text-muted">
          {status}
        </span>
        <IconButton
          label={t("editor.find.previous")}
          icon={ChevronUp}
          size="sm"
          onClick={() => editor.commands.findPrevious()}
        />
        <IconButton
          label={t("editor.find.next")}
          icon={ChevronDown}
          size="sm"
          onClick={() => editor.commands.findNext()}
        />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <Input
          aria-label={t("editor.find.replacement")}
          placeholder={t("editor.find.replacementPlaceholder")}
          value={replacement}
          onChange={(event) => setReplacement(event.target.value)}
        />
        <Button size="sm" variant="outline" onClick={() => editor.commands.replaceCurrent(replacement)}>
          {t("editor.find.replace")}
        </Button>
        <Button size="sm" variant="outline" onClick={() => editor.commands.replaceAll(replacement)}>
          {t("editor.find.replaceAll")}
        </Button>
      </div>
      <Checkbox
        label={t("editor.find.caseSensitive")}
        checked={caseSensitive}
        onCheckedChange={(checked) => setCaseSensitive(checked === true)}
      />
      <IconButton label={t("editor.find.close")} icon={X} size="sm" onClick={close} />
    </search>
  );
}
