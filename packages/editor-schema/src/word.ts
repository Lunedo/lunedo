import type { CalloutVariant, ContentColor, TextAlignment } from "./values.js";

export interface WordTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  subscript?: boolean;
  superscript?: boolean;
  muted?: boolean;
  color?: ContentColor;
  highlight?: ContentColor;
  link?: string;
}

export type WordInline = { type: "text"; text: string; style: WordTextStyle } | { type: "break" };

export interface WordListItem {
  checked: boolean | null;
  content: WordBlock[];
}

export interface WordTableCell {
  header: boolean;
  colspan: number;
  rowspan: number;
  width: number | null;
  background: ContentColor | null;
  content: WordBlock[];
}

export interface WordTableRow {
  cells: WordTableCell[];
}

export type WordBoxVariant = CalloutVariant | "neutral" | "decision";

export type WordBlock =
  | {
      type: "paragraph";
      content: WordInline[];
      align?: TextAlignment;
      indent?: number;
    }
  | { type: "heading"; level: number; anchor: string; content: WordInline[] }
  | { type: "list"; ordered: boolean; start: number; items: WordListItem[] }
  | { type: "table"; rows: WordTableRow[]; borderless: boolean }
  | { type: "code"; text: string; language: string | null }
  | { type: "box"; variant: WordBoxVariant; title: WordInline[]; content: WordBlock[] }
  | { type: "quote"; content: WordBlock[] }
  | {
      type: "image";
      attachmentId: string;
      href: string | null;
      alt: string;
      width: number | null;
      align: string;
    }
  | { type: "rule" }
  | { type: "contents"; minLevel: number; maxLevel: number }
  | { type: "placeholder"; text: string };

export type WordContent = WordBlock | WordInline;

export function isWordInline(content: WordContent): content is WordInline {
  return content.type === "text" || content.type === "break";
}

export function wordText(text: string, style: WordTextStyle = {}): WordInline {
  return { type: "text", text, style };
}

export function wordParagraph(content: WordInline[]): WordBlock {
  return { type: "paragraph", content };
}

export function wordBlocks(content: readonly WordContent[]): WordBlock[] {
  const blocks: WordBlock[] = [];
  let run: WordInline[] = [];
  const flush = () => {
    if (run.length > 0) blocks.push(wordParagraph(run));
    run = [];
  };
  for (const item of content) {
    if (isWordInline(item)) {
      run.push(item);
    } else {
      flush();
      blocks.push(item);
    }
  }
  flush();
  return blocks;
}

export function wordInlines(content: readonly WordContent[]): WordInline[] {
  return content.flatMap((item): WordInline[] => {
    if (isWordInline(item)) return [item];
    if (item.type === "paragraph" || item.type === "heading") return item.content;
    if (item.type === "placeholder") return [wordText(item.text, { muted: true, italic: true })];
    return [];
  });
}
