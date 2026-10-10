import { contentColors, isIsoDate } from "@pagehall/editor-schema";
import { Button, Field, Input, Popover, useToast } from "@pagehall/ui";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useEditable, useOpenPath, usePageContext } from "../context.js";
import { followTitleLink, pagePath, usePageReference, usePersonName } from "../references.js";

export function MentionView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const id = String(node.attrs.id);
  const name = usePersonName(id);
  return (
    <NodeViewWrapper
      as="span"
      className={`ph-mention${selected ? " ph-node-selected" : ""}`}
      data-account-id={id}
    >
      @{name ?? t("editor.mention.unknown")}
    </NodeViewWrapper>
  );
}

export function PageLinkView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const page = usePageContext();
  const open = useOpenPath();
  const { toast } = useToast();
  const pageId = node.attrs.pageId as string | null;
  const reference = usePageReference(pageId);
  const missing = pageId === null;
  const accessible = missing || reference?.accessible !== false;
  const title = missing
    ? String(node.attrs.title ?? "")
    : reference?.inTrash
      ? `${reference.title} (${t("editor.pageLink.inTrash")})`
      : reference?.accessible
        ? reference.title
        : reference
          ? t("editor.pageLink.noAccess")
          : String(node.attrs.title ?? t("editor.pageLink.loading"));
  const follow = async () => {
    if (!accessible) return;
    if (pageId && reference) {
      open(pagePath(reference.spaceKey, pageId, reference.title));
      return;
    }
    if (!page || !node.attrs.spaceId || !node.attrs.title) return;
    try {
      open(
        await followTitleLink(page.pageId, {
          spaceId: String(node.attrs.spaceId),
          title: String(node.attrs.title),
        }),
      );
    } catch {
      toast({
        variant: "error",
        title: t("editor.pageLink.followFailed"),
        description: t("editor.pageLink.followFailedDescription"),
      });
    }
  };
  return (
    <NodeViewWrapper as="span" className={selected ? "ph-node-selected" : undefined}>
      <button
        type="button"
        contentEditable={false}
        className="ph-page-link"
        data-missing={missing ? "true" : undefined}
        data-access={accessible ? undefined : "none"}
        aria-disabled={accessible ? undefined : true}
        title={missing ? t("editor.pageLink.missingHint") : undefined}
        onClick={() => void follow()}
      >
        {title}
      </button>
    </NodeViewWrapper>
  );
}

export function StatusView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(String(node.attrs.text));
  const [invalid, setInvalid] = useState(false);
  const color = String(node.attrs.color);
  const chip = (
    <button
      type="button"
      contentEditable={false}
      className="ph-status"
      data-color={color}
      aria-label={t("editor.status.edit", { text: node.attrs.text })}
      disabled={!editable}
    >
      {String(node.attrs.text)}
    </button>
  );
  const save = (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (value.length === 0 || value.length > 40) {
      setInvalid(true);
      return;
    }
    updateAttributes({ text: value });
    setOpen(false);
  };
  return (
    <NodeViewWrapper as="span" className={selected ? "ph-node-selected" : undefined}>
      {editable ? (
        <Popover trigger={chip} open={open} onOpenChange={setOpen} label={t("editor.status.title")}>
          <form className="flex flex-col gap-3" onSubmit={save}>
            <Field
              label={t("editor.status.text")}
              error={invalid ? t("editor.status.textInvalid") : undefined}
            >
              <Input
                value={text}
                maxLength={40}
                invalid={invalid}
                onChange={(event) => {
                  setText(event.target.value);
                  setInvalid(false);
                }}
              />
            </Field>
            <fieldset className="flex flex-wrap gap-1">
              <legend className="mb-1 text-sm font-medium">{t("editor.status.color")}</legend>
              {contentColors.map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  className="ph-status"
                  data-color={candidate}
                  aria-pressed={candidate === color}
                  onClick={() => updateAttributes({ color: candidate })}
                >
                  {translateKey(t, `editor.colors.${candidate}`)}
                </button>
              ))}
            </fieldset>
            <Button type="submit" size="sm">
              {t("editor.status.apply")}
            </Button>
          </form>
        </Popover>
      ) : (
        chip
      )}
    </NodeViewWrapper>
  );
}

export function DateView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const value = String(node.attrs.date);
  const label = isIsoDate(value) ? format.date(`${value}T12:00:00Z`) : value;
  const chip = (
    <button
      type="button"
      contentEditable={false}
      className="ph-date"
      aria-label={t("editor.date.edit", { date: label })}
      disabled={!editable}
    >
      <time dateTime={value}>{label}</time>
    </button>
  );
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      setOpen(false);
    }
  };
  return (
    <NodeViewWrapper as="span" className={selected ? "ph-node-selected" : undefined}>
      {editable ? (
        <Popover trigger={chip} open={open} onOpenChange={setOpen} label={t("editor.date.title")}>
          <Field label={t("editor.date.label")}>
            <Input
              type="date"
              value={value}
              onKeyDown={onKeyDown}
              onChange={(event) => {
                if (isIsoDate(event.target.value)) updateAttributes({ date: event.target.value });
              }}
            />
          </Field>
        </Popover>
      ) : (
        chip
      )}
    </NodeViewWrapper>
  );
}

export function EmojiView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" className="ph-emoji">
      {String(node.attrs.emoji)}
    </NodeViewWrapper>
  );
}

export function PlaceholderView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper
      as="span"
      className={`ph-placeholder${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      title={t("editor.placeholderNode.hint")}
    >
      {String(node.attrs.text)}
    </NodeViewWrapper>
  );
}

export function TemplateFieldView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const field = String(node.attrs.field);
  return (
    <NodeViewWrapper
      as="span"
      className={`ph-template-field${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      title={t("editor.templateField.hint", { field })}
    >
      {`{${field}}`}
    </NodeViewWrapper>
  );
}
