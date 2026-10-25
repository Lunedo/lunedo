import { calloutVariants, codeLanguages, FRAMED_SECTIONS, slugify } from "@lunedo/editor-schema";
import { Combobox, Menu } from "@lunedo/ui";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Columns2,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Info,
  Lightbulb,
  ListTree,
  type LucideIcon,
  StickyNote,
  Trash2,
  TriangleAlert,
  Ungroup,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../../i18n/translate.js";
import { NamedIcon } from "../../knowledge-bases/icons.js";
import { useEditable } from "../context.js";
import { dissolveLayout, removeLayoutColumn } from "../layout-commands.js";

const headingIcons: LucideIcon[] = [Heading1, Heading2, Heading3, Heading4, Heading5, Heading6];

const calloutIcons: Record<(typeof calloutVariants)[number], LucideIcon> = {
  info: Info,
  tip: Lightbulb,
  note: StickyNote,
  warning: TriangleAlert,
  error: CircleAlert,
};

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
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const minLevel = Number(node.attrs.minLevel ?? 1);
  const maxLevel = Number(node.attrs.maxLevel);
  const headings = useHeadings(editor).filter((entry) => entry.level >= minLevel && entry.level <= maxLevel);
  const minimum = Math.min(...headings.map((entry) => entry.level), 6);
  return (
    <NodeViewWrapper className={`ld-toc${selected ? " ld-node-selected" : ""}`} contentEditable={false}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <ListTree aria-hidden="true" className="size-icon-md" />
          {t("editor.toc.title")}
        </span>
        {editable ? (
          <span className="flex flex-wrap items-center gap-2">
            <Menu
              trigger={
                <button type="button" className="ld-inline-button">
                  {t("editor.toc.fromLevel", { level: minLevel })}
                  <ChevronDown aria-hidden="true" className="size-icon-sm" />
                </button>
              }
              items={[1, 2, 3, 4, 5, 6]
                .filter((level) => level <= maxLevel)
                .map((level) => ({
                  label: t("editor.toc.fromLevel", { level }),
                  icon: headingIcons[level - 1] ?? Heading6,
                  onSelect: () => updateAttributes({ minLevel: level }),
                }))}
            />
            <Menu
              trigger={
                <button type="button" className="ld-inline-button">
                  {t("editor.toc.levels", { level: maxLevel })}
                  <ChevronDown aria-hidden="true" className="size-icon-sm" />
                </button>
              }
              items={[1, 2, 3, 4, 5, 6]
                .filter((level) => level >= minLevel)
                .map((level) => ({
                  label: t("editor.toc.levels", { level }),
                  icon: headingIcons[level - 1] ?? Heading6,
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
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const variant = String(node.attrs.variant);
  return (
    <NodeViewWrapper as="aside" className="ld-callout" data-variant={variant} role="note">
      <div contentEditable={false} className="ld-callout-control">
        {editable ? (
          <Menu
            align="start"
            trigger={
              <button
                type="button"
                className="ld-callout-label ld-inline-button"
                aria-label={t("editor.callout.change", {
                  type: translateKey(t, `editor.callout.${variant}`),
                })}
              >
                <Info aria-hidden="true" className="size-icon-sm" />
                {translateKey(t, `editor.callout.${variant}`)}
              </button>
            }
            items={calloutVariants.map((candidate) => ({
              label: translateKey(t, `editor.callout.${candidate}`),
              icon: calloutIcons[candidate],
              onSelect: () => updateAttributes({ variant: candidate }),
            }))}
          />
        ) : (
          <span className="ld-callout-label">
            <Info aria-hidden="true" className="size-icon-sm" />
            {translateKey(t, `editor.callout.${variant}`)}
          </span>
        )}
      </div>
      <NodeViewContent className="ld-callout-content" />
    </NodeViewWrapper>
  );
}

export function ExpandView({ node, editor, updateAttributes }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const Toggle = open ? ChevronDown : ChevronRight;
  return (
    <NodeViewWrapper className="ld-expand" data-open={open ? "true" : "false"}>
      <div contentEditable={false} className="ld-expand-summary">
        <button
          type="button"
          className="ld-inline-button"
          aria-expanded={open}
          aria-label={t(open ? "editor.expand.collapse" : "editor.expand.open")}
          onClick={() => setOpen(!open)}
        >
          <Toggle aria-hidden="true" className="size-icon-md" />
        </button>
        <input
          className="ld-expand-title"
          value={String(node.attrs.title)}
          maxLength={500}
          readOnly={!editable}
          aria-label={t("editor.expand.titleLabel")}
          placeholder={t("editor.expand.titlePlaceholder")}
          onChange={(event) => updateAttributes({ title: event.target.value })}
        />
      </div>
      <NodeViewContent className="ld-expand-content" hidden={!open} />
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
  const editable = useEditable(editor);
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
  const removeColumn = (index: number) => {
    const position = getPos();
    if (typeof position !== "number") return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => removeLayoutColumn(tr, position, node, index))
      .run();
  };
  const dissolve = () => {
    const position = getPos();
    if (typeof position !== "number") return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => dissolveLayout(tr, position, node))
      .run();
  };
  return (
    <NodeViewWrapper className="ld-columns" data-count={count}>
      {editable ? (
        <div contentEditable={false} className="ld-columns-control">
          <Menu
            align="start"
            trigger={
              <button type="button" className="ld-inline-button" aria-label={t("editor.columns.layout")}>
                <Columns2 aria-hidden="true" className="size-icon-sm" />
              </button>
            }
            items={[
              ...(layouts.length > 1
                ? [
                    { type: "label" as const, label: t("editor.columns.widths") },
                    ...layouts.map((widths) => ({
                      label: widths.map((width) => `${width} %`).join(" · "),
                      icon: count === 3 ? Columns3 : Columns2,
                      onSelect: () => apply(widths),
                    })),
                    { type: "separator" as const },
                  ]
                : []),
              ...Array.from({ length: count }, (_, index) => ({
                label: t("editor.columns.removeColumn", { number: index + 1 }),
                icon: Trash2,
                onSelect: () => removeColumn(index),
              })),
              { type: "separator" as const },
              { label: t("editor.columns.dissolve"), icon: Ungroup, onSelect: dissolve },
            ]}
          />
        </div>
      ) : null}
      <NodeViewContent className="ld-columns-content" />
    </NodeViewWrapper>
  );
}

export function ColumnView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper
      className="ld-column"
      data-width={node.attrs.width}
      style={{ "--column-width": `${node.attrs.width}%` } as CSSProperties}
    >
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

export function CodeBlockView({ node, editor, updateAttributes }: NodeViewProps) {
  const editable = useEditable(editor);
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
    <NodeViewWrapper className="ld-code-block" data-language={language || undefined}>
      <div contentEditable={false} className="ld-code-toolbar">
        {editable ? (
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
  const key = String(node.attrs.key);
  const icon = typeof node.attrs.icon === "string" ? node.attrs.icon : null;
  return (
    <NodeViewWrapper
      as="section"
      className="ld-section"
      data-section={key}
      data-icon={icon ?? undefined}
      data-framed={FRAMED_SECTIONS.includes(key) ? "true" : undefined}
    >
      <h2 contentEditable={false}>
        <NamedIcon name={icon} className="ld-section-icon" />
        {String(node.attrs.title)}
      </h2>
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

export function UnsupportedMacroView({ node, selected }: NodeViewProps) {
  const { t } = useTranslation();
  return (
    <NodeViewWrapper
      className={`ld-unsupported-macro${selected ? " ld-node-selected" : ""}`}
      data-macro={node.attrs.name}
      contentEditable={false}
    >
      <p>{t("editor.unsupportedMacro", { name: String(node.attrs.name) })}</p>
    </NodeViewWrapper>
  );
}
