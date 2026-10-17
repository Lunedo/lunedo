import {
  cleanTabTitle,
  MAX_EMBED_HEIGHT,
  MAX_EMBED_TITLE,
  MAX_PREVIEW_HEIGHT,
  MAX_TAB_TITLE,
  MAX_TABS,
  MIN_EMBED_HEIGHT,
  MIN_PREVIEW_HEIGHT,
  resolveEmbed,
} from "@pagehall/editor-schema";
import { Button, Checkbox, Combobox, Field, Input, Select, useToast } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ArrowLeft, ArrowRight, Film, Paperclip, Plus, Presentation, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { useAttachmentPreview } from "../../files/preview-host.js";
import { useEditable } from "../context.js";
import { embedAddress } from "../embed-dialog.js";
import {
  EmbedFrame,
  InlineFilePreview,
  useEmbedServices,
  WhiteboardBlock,
  whiteboardReferenceQuery,
} from "../embedded-blocks.js";

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200] as const;

function parsedHeight(value: string, minimum: number, maximum: number): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!/^\d{1,4}$/.test(trimmed)) return undefined;
  const height = Number(trimmed);
  return height >= minimum && height <= maximum ? height : undefined;
}

function HeightField({
  label,
  hint,
  error,
  value,
  minimum,
  maximum,
  onChange,
}: {
  label: string;
  hint: string;
  error: string;
  value: number | null;
  minimum: number;
  maximum: number;
  onChange: (height: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [invalid, setInvalid] = useState(false);
  return (
    <Field label={label} hint={hint} error={invalid ? error : undefined}>
      <Input
        value={text}
        inputMode="numeric"
        invalid={invalid}
        onChange={(event) => {
          setText(event.target.value);
          if (invalid) setInvalid(parsedHeight(event.target.value, minimum, maximum) === undefined);
        }}
        onBlur={() => {
          const height = parsedHeight(text, minimum, maximum);
          setInvalid(height === undefined);
          if (height !== undefined && height !== value) onChange(height);
        }}
      />
    </Field>
  );
}

function EmbedSettings({
  attrs,
  onChange,
}: {
  attrs: Record<string, unknown>;
  onChange: (changes: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [address, setAddress] = useState(String(attrs.url ?? ""));
  const [invalid, setInvalid] = useState(false);
  const [title, setTitle] = useState(String(attrs.title ?? ""));
  const limits = { min: MIN_EMBED_HEIGHT, max: MAX_EMBED_HEIGHT };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field
          label={t("editor.embed.address")}
          hint={t("editor.embed.addressHint")}
          error={invalid ? t("editor.embed.addressInvalid") : undefined}
        >
          <Input
            value={address}
            invalid={invalid}
            inputMode="url"
            onChange={(event) => setAddress(event.target.value)}
            onBlur={() => {
              const url = embedAddress(address);
              setInvalid(url === null);
              if (url && url !== attrs.url) onChange({ url });
            }}
          />
        </Field>
      </div>
      <Field label={t("editor.embed.title")} hint={t("editor.embed.titleHint")}>
        <Input
          value={title}
          maxLength={MAX_EMBED_TITLE}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => onChange({ title: title.trim() })}
        />
      </Field>
      <HeightField
        label={t("editor.embed.height")}
        hint={t("editor.embed.heightHint", limits)}
        error={t("editor.embed.heightInvalid", limits)}
        value={typeof attrs.height === "number" ? attrs.height : null}
        minimum={MIN_EMBED_HEIGHT}
        maximum={MAX_EMBED_HEIGHT}
        onChange={(height) => onChange({ height })}
      />
    </div>
  );
}

export function EmbedView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const services = useEmbedServices();
  const url = String(node.attrs.url);
  const title = String(node.attrs.title || "") || url;
  const resolved = services ? resolveEmbed(url, services) : null;
  return (
    <NodeViewWrapper
      className={`ph-embed-block ph-include-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="embed"
    >
      <section className="flex flex-col gap-3" aria-label={t("editor.embed.label")}>
        <h3 className="flex items-center gap-2 font-semibold">
          <Film aria-hidden="true" className="size-icon-md" />
          {t("editor.embed.label")}
        </h3>
        {editable ? (
          <EmbedSettings attrs={node.attrs} onChange={(changes) => updateAttributes(changes)} />
        ) : null}
        <p className="text-sm text-text-muted" role="status">
          {services === null
            ? t("editor.embed.unknownAllowlist")
            : resolved
              ? t("editor.embed.allowed", { service: resolved.service.name })
              : t("editor.embed.blocked")}
        </p>
        {resolved ? (
          <EmbedFrame
            src={resolved.src}
            title={title}
            height={typeof node.attrs.height === "number" ? node.attrs.height : null}
          />
        ) : null}
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-sm wrap-anywhere">
          {title}
        </a>
      </section>
    </NodeViewWrapper>
  );
}

function boardLoader() {
  return async (query: string) => {
    const items = await request(() =>
      api.GET("/api/v1/items", { params: { query: { q: query, kind: "whiteboard", limit: 20 } } }),
    );
    return {
      items: items.map((item) => ({ value: item.id, label: item.title, description: item.spaceName })),
    };
  };
}

export function WhiteboardView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const whiteboardId = typeof node.attrs.whiteboardId === "string" ? node.attrs.whiteboardId : null;
  const board = useQuery({
    ...whiteboardReferenceQuery(whiteboardId ?? ""),
    enabled: whiteboardId !== null,
    throwOnError: false,
  });
  return (
    <NodeViewWrapper
      className={`ph-whiteboard-block ph-include-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="whiteboard"
    >
      <section className="flex flex-col gap-3" aria-label={t("editor.whiteboard.label")}>
        <h3 className="flex items-center gap-2 font-semibold">
          <Presentation aria-hidden="true" className="size-icon-md" />
          {t("editor.whiteboard.label")}
        </h3>
        {editable ? (
          <Field label={t("editor.whiteboard.picker")} hint={t("editor.whiteboard.pickerHint")}>
            <Combobox
              aria-label={t("editor.whiteboard.picker")}
              value={whiteboardId}
              emptyText={t("editor.whiteboard.noMatch")}
              selectedItem={
                whiteboardId
                  ? {
                      value: whiteboardId,
                      label:
                        board.data?.title ?? (board.isError ? t("editor.readView.restrictedContent") : ""),
                    }
                  : null
              }
              load={boardLoader()}
              onValueChange={(value) => updateAttributes({ whiteboardId: value })}
            />
          </Field>
        ) : null}
        <WhiteboardBlock whiteboardId={whiteboardId} placeholders />
      </section>
    </NodeViewWrapper>
  );
}

export function FileView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const preview = useAttachmentPreview();
  const id = String(node.attrs.attachmentId);
  const name = String(node.attrs.name || "");
  const showPreview = node.attrs.preview === true;
  const height = typeof node.attrs.height === "number" ? node.attrs.height : null;
  const zoom = typeof node.attrs.zoom === "number" ? node.attrs.zoom : null;
  const limits = { min: MIN_PREVIEW_HEIGHT, max: MAX_PREVIEW_HEIGHT };
  return (
    <NodeViewWrapper
      className={`ph-file${showPreview ? " ph-file-with-preview" : ""}${selected ? " ph-node-selected" : ""}`}
      data-preview={showPreview ? "true" : undefined}
      contentEditable={false}
    >
      <div className="flex flex-col gap-3">
        <button
          type="button"
          className="inline-flex min-h-hit max-w-full items-center gap-2 self-start rounded-md border border-border px-3 hover:bg-hover focus-visible:focus-ring"
          onClick={() => preview?.open(id)}
        >
          <Paperclip aria-hidden="true" className="size-icon shrink-0" />
          <span className="truncate" title={name}>
            {name || t("editor.attachment.file", { name: "" })}
          </span>
        </button>
        {editable ? (
          <div className="flex flex-col gap-3 text-text">
            <Checkbox
              checked={showPreview}
              onCheckedChange={(value) => updateAttributes({ preview: value })}
              label={t("editor.filePreview.show")}
            />
            {showPreview ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <HeightField
                  label={t("editor.filePreview.height")}
                  hint={t("editor.filePreview.heightHint", limits)}
                  error={t("editor.filePreview.heightInvalid", limits)}
                  value={height}
                  minimum={MIN_PREVIEW_HEIGHT}
                  maximum={MAX_PREVIEW_HEIGHT}
                  onChange={(value) => updateAttributes({ height: value })}
                />
                <Field label={t("editor.filePreview.zoom")}>
                  <Select
                    value={zoom === null ? "fit" : String(zoom)}
                    onValueChange={(value) =>
                      updateAttributes({ zoom: value === "fit" ? null : Number(value) })
                    }
                    options={[
                      { value: "fit", label: t("editor.filePreview.zoomFit") },
                      ...ZOOM_LEVELS.map((level) => ({
                        value: String(level),
                        label: t("editor.filePreview.zoomPercent", { percent: level }),
                      })),
                    ]}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}
        {showPreview ? (
          <InlineFilePreview attachmentId={id} height={height} zoom={zoom} placeholders />
        ) : null}
      </div>
    </NodeViewWrapper>
  );
}

function tabPosition(tabs: ProseMirrorNode, start: number, index: number): number {
  let position = start + 1;
  for (let current = 0; current < index; current += 1) position += tabs.child(current).nodeSize;
  return position;
}

export function TabsView({ node, editor, getPos, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const { toast } = useToast();
  const count = node.childCount;
  const [active, setActive] = useState(0);
  const current = Math.min(active, count - 1);
  const currentTab = node.child(current);
  const [name, setName] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const titles = Array.from({ length: count }, (_, index) => String(node.child(index).attrs.title));
  const start = () => (typeof getPos === "function" ? getPos() : undefined);

  const rename = () => {
    const at = start();
    if (at === undefined || name === null) return;
    const title = name.replace(/\s+/g, " ").trim().slice(0, MAX_TAB_TITLE);
    if (title.length === 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setName(null);
    if (title === currentTab.attrs.title) return;
    const position = tabPosition(node, at, current);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...currentTab.attrs, title }));
  };

  const add = () => {
    const at = start();
    if (at === undefined) return;
    if (count >= MAX_TABS) {
      toast({ variant: "warning", title: t("editor.tabs.maximum", { count: MAX_TABS }) });
      return;
    }
    const { schema } = editor.state;
    const tab = schema.nodes.tab?.create(
      { title: cleanTabTitle(t("editor.tabs.newTab", { number: count + 1 }), "Tab") },
      schema.nodes.paragraph?.create(),
    );
    if (!tab) return;
    editor.view.dispatch(editor.state.tr.insert(at + node.nodeSize - 1, tab));
    setActive(count);
  };

  const remove = () => {
    const at = start();
    if (at === undefined) return;
    if (count === 1) {
      toast({ variant: "warning", title: t("editor.tabs.lastTab") });
      return;
    }
    const position = tabPosition(node, at, current);
    const title = String(currentTab.attrs.title);
    editor.view.dispatch(editor.state.tr.delete(position, position + currentTab.nodeSize));
    setActive(Math.max(0, current - 1));
    toast({
      variant: "success",
      title: t("editor.tabs.removed", { name: title }),
      undo: { onUndo: () => editor.chain().focus().undo().run(), seconds: 10 },
    });
  };

  const move = (offset: -1 | 1) => {
    const at = start();
    const target = current + offset;
    if (at === undefined || target < 0 || target >= count) return;
    const from = tabPosition(node, at, current);
    const moved = currentTab;
    let transaction = editor.state.tr.delete(from, from + moved.nodeSize);
    const after = transaction.doc.nodeAt(at);
    if (!after) return;
    transaction = transaction.insert(tabPosition(after, at, target), moved);
    editor.view.dispatch(transaction);
    setActive(target);
  };

  return (
    <NodeViewWrapper
      className={`ph-tabs-editor${selected ? " ph-node-selected" : ""}`}
      data-active={current}
      data-type="tabs"
    >
      <div contentEditable={false} className="ph-tabs-editor-header flex flex-col gap-2">
        <div
          className="flex items-center gap-1 overflow-x-auto"
          role="toolbar"
          aria-label={t("editor.tabs.label")}
        >
          {titles.map((title, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: tabs are identified by their position in the block
              key={index}
              type="button"
              aria-pressed={index === current}
              title={title}
              onClick={() => {
                setActive(index);
                setName(null);
              }}
              className="ph-tab-button"
            >
              {title}
            </button>
          ))}
          {editable ? (
            <Button size="sm" variant="outline" icon={Plus} onClick={add}>
              {t("editor.tabs.add")}
            </Button>
          ) : null}
        </div>
        {editable ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field
                label={t("editor.tabs.tabName")}
                error={invalid ? t("editor.tabs.nameRequired") : undefined}
              >
                <Input
                  value={name ?? String(currentTab.attrs.title)}
                  maxLength={MAX_TAB_TITLE}
                  invalid={invalid}
                  onChange={(event) => setName(event.target.value)}
                  onBlur={rename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      rename();
                    }
                  }}
                />
              </Field>
            </div>
            {current > 0 ? (
              <Button
                size="sm"
                variant="outline"
                icon={ArrowLeft}
                aria-label={t("editor.tabs.moveLeft", { name: titles[current] })}
                onClick={() => move(-1)}
              />
            ) : null}
            {current < count - 1 ? (
              <Button
                size="sm"
                variant="outline"
                icon={ArrowRight}
                aria-label={t("editor.tabs.moveRight", { name: titles[current] })}
                onClick={() => move(1)}
              />
            ) : null}
            <Button size="sm" variant="outline" icon={Trash2} onClick={remove}>
              {t("editor.tabs.remove", { name: titles[current] })}
            </Button>
          </div>
        ) : null}
      </div>
      <NodeViewContent className="ph-tabs-editor-content" />
    </NodeViewWrapper>
  );
}
