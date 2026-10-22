import { type DocumentJson, extractMentions, validateComment } from "@lunedo/editor-schema";
import { Button, Notice } from "@lunedo/ui";
import { Extension } from "@tiptap/core";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import { Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createMentionSuggestion } from "../editor/extensions/index.js";
import { personName } from "../editor/references.js";
import { commentSchemaExtensions } from "../editor/schema/extensions.js";
import { checkMentionAccess } from "./people.js";

const ACCESS_CHECK_MS = 400;

export function CommentComposer({
  pageId,
  label,
  placeholder,
  submitLabel,
  initial,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  pageId: string;
  label: string;
  placeholder: string;
  submitLabel: string;
  initial?: DocumentJson;
  autoFocus?: boolean;
  onSubmit: (body: DocumentJson) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  const labelId = useId();
  const hintId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mentions, setMentions] = useState<string[]>([]);
  const [withoutAccess, setWithoutAccess] = useState<string[]>([]);
  const submit = useRef<() => void>(() => undefined);
  const editor = useEditor(
    {
      extensions: [
        ...commentSchemaExtensions().map((extension) =>
          extension.name === "mention"
            ? extension.configure({ suggestion: createMentionSuggestion(t) })
            : extension,
        ),
        UndoRedo,
        Placeholder.configure({ placeholder }),
        Extension.create({
          name: "commentShortcuts",
          addKeyboardShortcuts: () => ({
            "Mod-Enter": () => {
              submit.current();
              return true;
            },
          }),
        }),
      ],
      ...(initial ? { content: initial } : {}),
      autofocus: autoFocus ? "end" : false,
      editorProps: {
        attributes: {
          class:
            "ld-content ld-comment-editor min-h-control-lg rounded-md border border-control-border bg-surface px-3 py-2 focus-visible:focus-ring",
          role: "textbox",
          "aria-multiline": "true",
          "aria-labelledby": labelId,
        },
      },
      onUpdate: ({ editor: current }) => {
        setError(null);
        setMentions(extractMentions(current.getJSON() as DocumentJson));
      },
    },
    [],
  );

  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute("aria-invalid", error ? "true" : "false");
    editor.view.dom.setAttribute("aria-describedby", error ? `${errorId} ${hintId}` : hintId);
  }, [editor, error, errorId, hintId]);

  useEffect(() => {
    if (mentions.length === 0) {
      setWithoutAccess([]);
      return;
    }
    const timer = setTimeout(() => {
      void checkMentionAccess(pageId, mentions).then((access) =>
        setWithoutAccess(access.filter((entry) => !entry.hasAccess).map((entry) => entry.accountId)),
      );
    }, ACCESS_CHECK_MS);
    return () => clearTimeout(timer);
  }, [mentions, pageId]);

  submit.current = () => {
    if (!editor || busy) return;
    const body = editor.getJSON() as DocumentJson;
    const validation = validateComment(body);
    if (!validation.ok) {
      setError(
        validation.problems.some((problem) => problem.code === "tooLarge")
          ? t("comments.tooLong")
          : t("comments.emptyError"),
      );
      editor.commands.focus();
      return;
    }
    setBusy(true);
    void onSubmit(validation.document)
      .then((done) => {
        if (done) {
          editor.commands.clearContent(true);
          setMentions([]);
        }
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <EditorContent editor={editor} />
      <p id={hintId} className="text-xs text-text-muted">
        {t("comments.hint")}
      </p>
      {error ? (
        <p id={errorId} className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {withoutAccess.map((id) => (
        <Notice key={id} variant="warning">
          {t("mentions.noAccess", { name: personName(id) ?? t("editor.mention.unknown") })}
        </Notice>
      ))}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t("comments.cancel")}
          </Button>
        ) : null}
        <Button variant="primary" size="sm" icon={Send} loading={busy} onClick={() => submit.current()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
