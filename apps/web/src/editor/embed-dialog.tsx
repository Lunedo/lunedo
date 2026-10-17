import { isEmbeddableUrl, MAX_EMBED_TITLE, resolveEmbed } from "@pagehall/editor-schema";
import { Button, Dialog, Field, focusFirstInvalidSoon, Input } from "@pagehall/ui";
import type { Editor } from "@tiptap/core";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEmbedServices } from "./embedded-blocks.js";
import { normalizeHref } from "./link-dialog.js";

export function embedAddress(value: string): string | null {
  const href = normalizeHref(value);
  return href && isEmbeddableUrl(href) ? href : null;
}

export function EmbedDialog({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const services = useEmbedServices();
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [invalid, setInvalid] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    setAddress("");
    setTitle("");
    setInvalid(false);
  }, [open]);

  const close = () => {
    onOpenChange(false);
    editor.commands.focus();
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const url = embedAddress(address);
    if (!url) {
      setInvalid(true);
      focusFirstInvalidSoon(form.current ?? undefined);
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent({ type: "embed", attrs: { url, title: title.trim().slice(0, MAX_EMBED_TITLE) } })
      .run();
    onOpenChange(false);
  };

  const url = embedAddress(address);
  const resolved = url && services ? resolveEmbed(url, services) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("editor.embed.label")}
      size="sm"
    >
      <form ref={form} className="flex flex-col gap-3" onSubmit={apply} noValidate>
        <Field
          label={t("editor.embed.address")}
          hint={t("editor.embed.addressHint")}
          error={invalid ? t("editor.embed.addressInvalid") : undefined}
        >
          <Input
            value={address}
            invalid={invalid}
            inputMode="url"
            placeholder={t("editor.embed.addressPlaceholder")}
            onChange={(event) => {
              setAddress(event.target.value);
              if (invalid) setInvalid(embedAddress(event.target.value) === null);
            }}
          />
        </Field>
        {url ? (
          <p className="text-sm text-text-muted" role="status">
            {services === null
              ? t("editor.embed.unknownAllowlist")
              : resolved
                ? t("editor.embed.allowed", { service: resolved.service.name })
                : t("editor.embed.blocked")}
          </p>
        ) : null}
        <Field label={t("editor.embed.title")} hint={t("editor.embed.titleHint")}>
          <Input
            value={title}
            maxLength={MAX_EMBED_TITLE}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {t("editor.embed.cancel")}
          </Button>
          <Button type="submit">{t("editor.embed.insert")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
