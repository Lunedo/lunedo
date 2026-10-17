import { Button, Field, Input, Menu, Popover } from "@pagehall/ui";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Braces, MessageSquareText } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type EditorActions, registerEditorActions } from "./actions.js";
import { EmbedDialog } from "./embed-dialog.js";
import { EmojiPicker } from "./emoji-picker.js";
import { createEditorExtensions } from "./extensions/index.js";
import { LinkDialog } from "./link-dialog.js";
import { SelectionMenu, TableMenu } from "./menus.js";
import { EditorToolbar } from "./toolbar.js";
import { toolbarItems } from "./toolbar-items.js";
import "./editor.css";

export interface TemplateFieldOption {
  key: string;
  label: string;
}

export function TemplateContentEditor({
  initial,
  fields,
  label,
  onChange,
}: {
  initial: unknown;
  fields: TemplateFieldOption[];
  label: string;
  onChange: (document: unknown) => void;
}) {
  const { t } = useTranslation();
  const [linkOpen, setLinkOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const actions = useMemo<EditorActions>(
    () => ({
      openEmojiPicker: () => setEmojiOpen(true),
      openLinkDialog: () => setLinkOpen(true),
      openEmbedDialog: () => setEmbedOpen(true),
      openFind: () => undefined,
      focusToolbar: () => undefined,
    }),
    [],
  );
  const editor = useEditor({
    extensions: createEditorExtensions({ t, spaceId: null, collaboration: null }),
    content: initial as object,
    editorProps: {
      attributes: {
        class: "ph-content ph-editor-content",
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
  });
  useEffect(() => (editor ? registerEditorActions(editor, actions) : undefined), [editor, actions]);
  const items = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? toolbarItems(current, t, actions) : []),
  });
  if (!editor) return null;
  return (
    <div className="ph-page-editor flex flex-col gap-2">
      <div className="flex flex-col gap-1 rounded-md border border-border bg-surface p-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <div className="min-w-0 flex-1">
            <EditorToolbar editor={editor} items={items ?? []} />
          </div>
          <PlaceholderButton
            onInsert={(text) =>
              editor.chain().focus().insertContent({ type: "placeholder", attrs: { text } }).run()
            }
          />
          <Menu
            trigger={
              <Button size="sm" variant="secondary" icon={Braces}>
                {t("templates.insertField")}
              </Button>
            }
            items={
              fields.length === 0
                ? [{ type: "label", label: t("templates.noFieldsYet") }]
                : fields.map((field) => ({
                    label: field.label || field.key,
                    onSelect: () =>
                      editor
                        .chain()
                        .focus()
                        .insertContent({ type: "templateField", attrs: { field: field.key } })
                        .run(),
                  }))
            }
          />
        </div>
        <TableMenu editor={editor} />
      </div>
      <div className="ph-editor-surface relative min-h-field rounded-md border border-border p-3">
        <EditorContent editor={editor} />
      </div>
      <SelectionMenu editor={editor} actions={actions} />
      <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
      <EmbedDialog editor={editor} open={embedOpen} onOpenChange={setEmbedOpen} />
      <EmojiPicker
        open={emojiOpen}
        onOpenChange={setEmojiOpen}
        onSelect={(emoji) => editor.chain().focus().insertContent({ type: "emoji", attrs: { emoji } }).run()}
      />
    </div>
  );
}

function PlaceholderButton({ onInsert }: { onInsert: (text: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (value.length === 0 || value.length > 500) {
      setError(t("templates.placeholderInvalid"));
      return;
    }
    onInsert(value);
    setText("");
    setError(null);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label={t("templates.insertPlaceholder")}
      trigger={
        <Button size="sm" variant="secondary" icon={MessageSquareText}>
          {t("templates.insertPlaceholder")}
        </Button>
      }
    >
      <form noValidate className="flex w-card max-w-full flex-col gap-3" onSubmit={submit}>
        <Field
          label={t("templates.placeholderText")}
          hint={t("templates.placeholderHint")}
          error={error ?? undefined}
        >
          <Input
            value={text}
            placeholder={t("templates.placeholderExample")}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            {t("templates.insert")}
          </Button>
        </div>
      </form>
    </Popover>
  );
}
