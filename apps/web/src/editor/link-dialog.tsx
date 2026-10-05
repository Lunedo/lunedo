import { isAllowedHref } from "@pagehall/editor-schema";
import { Button, Combobox, type ComboboxLoader, Dialog, Field, focusFirstInvalid, Input } from "@pagehall/ui";
import type { Editor } from "@tiptap/core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchPages } from "./references.js";

export function normalizeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:|^\//i.test(trimmed)
    ? trimmed
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
      ? `mailto:${trimmed}`
      : `https://${trimmed}`;
  return isAllowedHref(candidate) ? candidate : null;
}

export function LinkDialog({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [address, setAddress] = useState("");
  const [invalid, setInvalid] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    setAddress(String(editor.getAttributes("link").href ?? ""));
    setInvalid(false);
  }, [open, editor]);

  const close = () => {
    onOpenChange(false);
    editor.commands.focus();
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const href = normalizeHref(address);
    if (!href) {
      setInvalid(true);
      if (form.current) focusFirstInvalid(form.current);
      return;
    }
    const { empty } = editor.state.selection;
    if (empty && !editor.isActive("link")) {
      editor
        .chain()
        .focus()
        .insertContent({ type: "text", text: address.trim(), marks: [{ type: "link", attrs: { href } }] })
        .run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    onOpenChange(false);
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onOpenChange(false);
  };

  const loadPages: ComboboxLoader = async (query) => {
    if (!query.trim()) return { items: [] };
    const pages = await searchPages(query.trim());
    return {
      items: pages.map((page) => ({ value: page.id, label: page.title, description: page.spaceName })),
    };
  };

  const choosePage = (pageId: string | null, label: string | undefined) => {
    if (!pageId) return;
    editor
      .chain()
      .focus()
      .insertContent([
        { type: "pageLink", attrs: { pageId, spaceId: null, title: label ?? null } },
        { type: "text", text: " " },
      ])
      .run();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("editor.link.title")}
      size="sm"
    >
      <div className="flex flex-col gap-5">
        <form ref={form} className="flex flex-col gap-3" onSubmit={apply} noValidate>
          <Field
            label={t("editor.link.address")}
            hint={t("editor.link.addressHint")}
            error={invalid ? t("editor.link.addressInvalid") : undefined}
          >
            <Input
              value={address}
              invalid={invalid}
              inputMode="url"
              placeholder={t("editor.link.addressPlaceholder")}
              onChange={(event) => {
                setAddress(event.target.value);
                if (invalid) setInvalid(normalizeHref(event.target.value) === null);
              }}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            {editor.isActive("link") ? (
              <Button variant="danger" onClick={remove}>
                {t("editor.link.remove")}
              </Button>
            ) : null}
            <Button type="submit">{t("editor.link.apply")}</Button>
          </div>
        </form>
        <Field label={t("editor.link.page")} hint={t("editor.link.pageHint")}>
          <Combobox
            load={loadPages}
            value={null}
            placeholder={t("editor.link.pagePlaceholder")}
            emptyText={t("editor.suggestions.empty")}
            onValueChange={(value, item) => choosePage(value, item?.label)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
