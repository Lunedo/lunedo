import { calloutVariants, codeLanguages, slugify } from "@pagehall/editor-schema";
import { Combobox, Menu } from "@pagehall/ui";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ChevronDown, ChevronRight, Columns2, Info, ListTree, Paperclip } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { contentUrl } from "../../files/attachments-api.js";
import { useAttachmentPreview } from "../../files/preview-host.js";
import { translateKey } from "../../i18n/translate.js";

export interface TocEntry {
  level: number;
  text: string;
  id: string;
}

export function headingsOf(doc: ProseMirrorNode): TocEntry[] {
  const entries: TocEntry[] = [];
  const used = new Map<string, number>();
  doc.descendants((node) => {
    const level =
      node.type.name === "heading" ? Number(node.attrs.level) : node.type.name === "section" ? 2 : null;
    if (level === null) return true;
    const text = (node.type.name === "section" ? String(node.attrs.title) : node.textContent).trim();
    const base = slugify(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    entries.push({ level, text, id: count === 0 ? base : `${base}-${count + 1}` });
    return node.type.name === "section";
  });
  return entries;
}

function useHeadings(editor: Editor): TocEntry[] {
  const [entries, setEntries] = useState(() => headingsOf(editor.state.doc));
  useEffect(() => {
    const update = () => setEntries(headingsOf(editor.state.doc));
    editor.on("update", update);
    return () => {
      editor.off("update", update);
    };
  }, [editor]);
  return entries;
}

export function TableOfContentsView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const minLevel = Number(node.attrs.minLevel ?? 1);
  const maxLevel = Number(node.attrs.maxLevel);
  const headings = useHeadings(editor).filter((entry) => entry.level >= minLevel && entry.level <= maxLevel);
  const minimum = Math.min(...headings.map((entry) => entry.level), 6);
  return (
    <NodeViewWrapper className={`ph-toc${selected ? " ph-node-selected" : ""}`} contentEditable={false}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <ListTree aria-hidden="true" className="size-icon-md" />
          {t("editor.toc.title")}
        </span>
        {editor.isEditable ? (
          <span className="flex flex-wrap items-center gap-2">
            <Menu
              trigger={
                <button type="button" className="ph-inline-button">
                  {t("editor.toc.fromLevel", { level: minLevel })}
                  <ChevronDown aria-hidden="true" className="size-icon-sm" />
                </button>
              }
              items={[1, 2, 3, 4, 5, 6]
                .filter((level) => level <= maxLevel)
                .map((level) => ({
                  label: t("editor.toc.fromLevel", { level }),
                  onSelect: () => updateAttributes({ minLevel: level }),
                }))}
            />
            <Menu
              trigger={
                <button type="button" className="ph-inline-button">
                  {t("editor.toc.levels", { level: maxLevel })}
                  <ChevronDown aria-hidden="true" className="size-icon-sm" />
                </button>
              }
              items={[1, 2, 3, 4, 5, 6]
                .filter((level) => level >= minLevel)
                .map((level) => ({
                  label: t("editor.toc.levels", { level }),
                  onSelect: () => updateAttributes({ maxLevel: level }),
                }))}
            />
          </span>
        ) : null}
      </div>
      {headings.length === 0 ? (
        <p className="text-sm text-text-muted">{t("editor.toc.empty")}</p>
      ) : (
        <ul>
          {headings.map((entry) => (
            <li key={entry.id} data-level={entry.level - minimum + 1}>
              <a href={`#${entry.id}`}>{entry.text || t("editor.toc.untitled")}</a>
            </li>
          ))}
        </ul>
      )}
    </NodeViewWrapper>
  );
}

export function CalloutView({ node, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const variant = String(node.attrs.variant);
  return (
    <NodeViewWrapper as="aside" className="ph-callout" data-variant={variant} role="note">
      <div contentEditable={false} className="ph-callout-control">
        {editor.isEditable ? (
          <Menu
            align="start"
            trigger={
              <button
                type="button"
                className="ph-callout-label ph-inline-button"
                aria-label={t("editor.callout.change")}
              >
                <Info aria-hidden="true" className="size-icon-sm" />
                {translateKey(t, `editor.callout.${variant}`)}
              </button>
            }
            items={calloutVariants.map((candidate) => ({
              label: translateKey(t, `editor.callout.${candidate}`),
              onSelect: () => updateAttributes({ variant: candidate }),
            }))}
          />
        ) : (
          <span className="ph-callout-label">
            <Info aria-hidden="true" className="size-icon-sm" />
            {translateKey(t, `editor.callout.${variant}`)}
          </span>
        )}
      </div>
      <NodeViewContent className="ph-callout-content" />
    </NodeViewWrapper>
  );
}

export function ExpandView({ node, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const Toggle = open ? ChevronDown : ChevronRight;
  return (
    <NodeViewWrapper className="ph-expand" data-open={open ? "true" : "false"}>
      <div contentEditable={false} className="ph-expand-summary">
        <button
          type="button"
          className="ph-inline-button"
          aria-expanded={open}
          aria-label={t(open ? "editor.expand.collapse" : "editor.expand.open")}
          onClick={() => setOpen(!open)}
        >
          <Toggle aria-hidden="true" className="size-icon-md" />
        </button>
        <input
          className="ph-expand-title"
          value={String(node.attrs.title)}
          maxLength={500}
          readOnly={!editor.isEditable}
          aria-label={t("editor.expand.titleLabel")}
          placeholder={t("editor.expand.titlePlaceholder")}
          onChange={(event) => updateAttributes({ title: event.target.value })}
        />
      </div>
      <NodeViewContent className="ph-expand-content" hidden={!open} />
    </NodeViewWrapper>
  );
}

export const COLUMN_LAYOUTS: Record<number, number[][]> = {
  2: [
    [50, 50],
    [33, 67],
    [67, 33],
  ],
  3: [
    [33, 34, 33],
    [25, 50, 25],
  ],
  4: [[25, 25, 25, 25]],
};

export function ColumnsView({ node, editor, getPos }: NodeViewProps) {
  const { t } = useTranslation();
  const count = node.childCount;
  const layouts = COLUMN_LAYOUTS[count] ?? [];
  const apply = (widths: number[]) => {
    const position = getPos();
    if (typeof position !== "number") return;
    editor
      .chain()
      .command(({ tr }) => {
        let offset = position + 1;
        node.forEach((column, _offset, index) => {
          tr.setNodeMarkup(offset, undefined, { ...column.attrs, width: widths[index] });
          offset += column.nodeSize;
        });
        return true;
      })
      .run();
  };
  return (
    <NodeViewWrapper className="ph-columns" data-count={count}>
      {editor.isEditable && layouts.length > 1 ? (
        <div contentEditable={false} className="ph-columns-control">
          <Menu
            align="start"
            trigger={
              <button type="button" className="ph-inline-button" aria-label={t("editor.columns.layout")}>
                <Columns2 aria-hidden="true" className="size-icon-sm" />
              </button>
            }
            items={layouts.map((widths) => ({
              label: widths.map((width) => `${width} %`).join(" · "),
              onSelect: () => apply(widths),
            }))}
          />
        </div>
      ) : null}
      <NodeViewContent className="ph-columns-content" />
    </NodeViewWrapper>
  );
}

export function ColumnView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper
      className="ph-column"
      data-width={node.attrs.width}
      style={{ "--column-width": `${node.attrs.width}%` } as CSSProperties}
    >
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

export function CodeBlockView({ node, editor, updateAttributes }: NodeViewProps) {
  const { t } = useTranslation();
  const items = useMemo(
    () => [
      { value: "", label: t("editor.code.plain") },
      ...codeLanguages.map((language) => ({ value: language, label: language })),
    ],
    [t],
  );
  const language = (node.attrs.language as string | null) ?? "";
  return (
    <NodeViewWrapper className="ph-code-block" data-language={language || undefined}>
      <div contentEditable={false} className="ph-code-toolbar">
        {editor.isEditable ? (
          <div className="w-field max-w-full">
            <Combobox
              aria-label={t("editor.code.language")}
              items={items}
              value={language}
              placeholder={t("editor.code.searchLanguage")}
              onValueChange={(value) => updateAttributes({ language: value ? value : null })}
            />
          </div>
        ) : (
          <span className="text-xs text-text-muted">{language || t("editor.code.plain")}</span>
        )}
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" className={language ? `hljs language-${language}` : "hljs"} />
      </pre>
    </NodeViewWrapper>
  );
}

export function SectionView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper as="section" className="ph-section" data-section={node.attrs.key}>
      <h2 contentEditable={false}>{String(node.attrs.title)}</h2>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

export function UnsupportedMacroView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper
      className={`ph-unsupported-macro${selected ? " ph-node-selected" : ""}`}
      data-macro={node.attrs.name}
      contentEditable={false}
    >
      <p>{t("editor.unsupportedMacro", { name: String(node.attrs.name) })}</p>
    </NodeViewWrapper>
  );
}

export function AttachmentView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  const preview = useAttachmentPreview();
  const id = String(node.attrs.attachmentId);
  const isImage = node.type.name === "image";
  const name = String((isImage ? node.attrs.alt : node.attrs.name) || "");
  return (
    <NodeViewWrapper
      className={`${isImage ? "ph-image" : "ph-file"}${selected ? " ph-node-selected" : ""}`}
      data-align={isImage ? String(node.attrs.align) : undefined}
      contentEditable={false}
    >
      {isImage ? (
        <img src={contentUrl(id)} alt={name} loading="lazy" draggable={false} />
      ) : (
        <button
          type="button"
          className="inline-flex min-h-hit items-center gap-2 rounded-md border border-border px-3 hover:bg-hover focus-visible:focus-ring"
          onClick={() => preview?.open(id)}
        >
          <Paperclip aria-hidden="true" className="size-icon" />
          {name || t("editor.attachment.file", { name: "" })}
        </button>
      )}
    </NodeViewWrapper>
  );
}
