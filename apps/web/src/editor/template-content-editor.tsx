import { Button, Field, Input, Menu, Popover, useToast } from "@pagehall/ui";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Braces, ImagePlus, MessageSquareText } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../errors/problem-message.js";
import { AttachmentSourceProvider } from "../files/attachment-source.js";
import { uploadQueue } from "../files/upload-queue.js";
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

export interface TemplateImages {
  url: (fileId: string) => string;
  upload: ((file: File) => Promise<{ id: string; name: string }>) | null;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

export function TemplateContentEditor({
  initial,
  fields,
  label,
  images,
  onChange,
}: {
  initial: unknown;
  fields: TemplateFieldOption[];
  label: string;
  images?: TemplateImages | undefined;
  onChange: (document: unknown) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const editorRef = useRef<Editor | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const direct = images?.upload ?? null;
  const latest = useRef(direct);
  latest.current = direct;
  const queued = useRef(
    uploadQueue((file: File) => {
      const current = latest.current;
      return current ? current(file) : Promise.reject(new Error("The template is not saved yet"));
    }),
  );
  const upload = direct ? queued.current : null;
  const insertImages = useCallback(
    (files: File[], position: number | null) => {
      if (!upload) return;
      for (const file of files) {
        if (!IMAGE_TYPES.includes(file.type)) {
          toast({
            variant: "error",
            title: t("templates.imageFailed", { name: file.name }),
            description: t("templates.imageTypes"),
          });
          continue;
        }
        setUploading((count) => count + 1);
        upload(file)
          .then((stored) => {
            const current = editorRef.current;
            if (!current || current.isDestroyed) return;
            const size = current.state.doc.content.size;
            const at = position !== null && position <= size ? position : current.state.selection.to;
            current
              .chain()
              .insertContentAt(at, { type: "image", attrs: { attachmentId: stored.id, alt: stored.name } })
              .run();
          })
          .catch((failure: unknown) =>
            toast({
              variant: "error",
              title: t("templates.imageFailed", { name: file.name }),
              description: problemMessage(t, failure),
            }),
          )
          .finally(() => setUploading((count) => count - 1));
      }
    },
    [upload, t, toast],
  );
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
    extensions: createEditorExtensions({
      t,
      spaceId: null,
      collaboration: null,
      ...(upload ? { onFiles: insertImages } : {}),
    }),
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
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);
  useEffect(() => (editor ? registerEditorActions(editor, actions) : undefined), [editor, actions]);
  const items = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? toolbarItems(current, t, actions) : []),
  });
  if (!editor) return null;
  const content = (
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
          {images ? (
            <Button
              size="sm"
              variant="secondary"
              icon={ImagePlus}
              loading={uploading > 0}
              disabled={!upload}
              onClick={() => fileInput.current?.click()}
            >
              {t("templates.insertImage")}
            </Button>
          ) : null}
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
      {images && !upload ? <p className="text-sm text-text-muted">{t("templates.imagesAfterSave")}</p> : null}
      {upload ? (
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => {
            insertImages([...(event.target.files ?? [])], null);
            event.target.value = "";
          }}
        />
      ) : null}
    </div>
  );
  return images ? <AttachmentSourceProvider url={images.url}>{content}</AttachmentSourceProvider> : content;
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
