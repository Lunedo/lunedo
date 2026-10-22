import type { WordBlock, WordInline, WordListItem, WordTableCell } from "@lunedo/editor-schema";
import designTokens from "@lunedo/tokens/design-tokens.json" with { type: "json" };
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  PageOrientation,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
} from "docx";
import type { ExportOptions, PaperSize } from "./options.js";
import type { PrintAttachment } from "./print.js";
import type { ExportTexts } from "./texts.js";

type ContentColors = (typeof designTokens.color.content)["light"];
type ContentColorName = keyof ContentColors;
type FileChild = Paragraph | Table | TableOfContents;

export interface WordImage {
  data: Buffer;
  type: "png" | "jpg" | "gif" | "bmp" | "svg";
  width: number;
  height: number;
}

export interface WordComment {
  quote: string | null;
  author: string;
  date: string;
  body: readonly WordBlock[];
  replies: readonly { author: string; date: string; body: readonly WordBlock[] }[];
}

export interface WordPage {
  id: string;
  depth: number;
  title: string;
  path: readonly string[];
  meta: readonly string[];
  blocks: readonly WordBlock[];
  comments: readonly WordComment[];
}

export interface WordDocument {
  title: string;
  path: readonly string[];
  exported: string;
  options: ExportOptions;
  texts: ExportTexts;
  pages: readonly WordPage[];
  attachments: readonly PrintAttachment[];
  image(attachmentId: string): Promise<WordImage | null>;
  leftOut(attachmentId: string): boolean;
}

const TWIPS_PER_MM = 1440 / 25.4;
const PIXELS_PER_TWIP = 96 / 1440;
const MARGIN = Math.round(20 * TWIPS_PER_MM);
const PAPER: Record<PaperSize, { width: number; height: number }> = {
  a4: { width: 11906, height: 16838 },
  letter: { width: 12240, height: 15840 },
};
const CODE_FONT = "Consolas";
const CODE_STYLE = "Code";
const BULLETS = "lunedo-bullets";
const MAX_LEVEL = 8;
const LIST_INDENT = 360;
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;
const SAFE_LINK = /^(https?:|mailto:)/i;
const SVG_FALLBACK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const SVG_ROOT = /<svg\b[^>]*>/i;
const SVG_DEFAULT_SIZE = { width: 800, height: 600 };

const { color } = designTokens;

function hex(value: string): string {
  return value.replace(/^#/, "").toUpperCase();
}

function content(name: string | undefined, part: "text" | "background"): string | undefined {
  const entry = name ? color.content.light[name as ContentColorName] : undefined;
  return entry ? hex(entry[part]) : undefined;
}

export function svgPalette(name: ContentColorName, part: "text" | "background"): string {
  return `#${content(name, part) ?? hex(color.light.textMuted)}`;
}

const MUTED = hex(color.light.textMuted);
const BORDER = hex(color.light.border);
const SUNKEN = hex(color.light.surfaceSunken);
const BOX_COLORS: Record<string, { border: string; fill: string }> = {
  info: { border: hex(color.light.info), fill: hex(color.light.infoSoft) },
  note: { border: hex(color.light.info), fill: hex(color.light.infoSoft) },
  tip: { border: hex(color.light.success), fill: hex(color.light.successSoft) },
  decision: { border: hex(color.light.success), fill: hex(color.light.successSoft) },
  warning: { border: hex(color.light.warning), fill: hex(color.light.warningSoft) },
  error: { border: hex(color.light.danger), fill: hex(color.light.dangerSoft) },
  neutral: { border: BORDER, fill: hex(color.light.surface) },
  quote: { border: BORDER, fill: hex(color.light.bg) },
};

function none() {
  return { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
}

function line(size = 4, value = BORDER) {
  return { style: BorderStyle.SINGLE, size, color: value };
}

function inCell(children: readonly FileChild[]): (Paragraph | Table)[] {
  const allowed = children.filter((child): child is Paragraph | Table => !(child instanceof TableOfContents));
  return allowed.length > 0 ? allowed : [new Paragraph({ children: [] })];
}

class WordWriter {
  readonly #document: WordDocument;
  readonly #textWidth: number;
  readonly #orderedStarts = new Map<number, string>();
  #instance = 0;
  #shift = 0;

  constructor(document: WordDocument) {
    this.#document = document;
    const paper = PAPER[document.options.paper];
    const width = document.options.orientation === "landscape" ? paper.height : paper.width;
    this.#textWidth = width - 2 * MARGIN;
  }

  get numbering() {
    const levels = (
      format: (typeof LevelFormat)[keyof typeof LevelFormat],
      start: number,
      text: (level: number) => string,
    ) =>
      Array.from({ length: MAX_LEVEL + 1 }, (_, level) => ({
        level,
        format,
        text: text(level),
        start,
        alignment: AlignmentType.START,
        style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: LIST_INDENT } } },
      }));
    const bullets = ["•", "◦", "▪"];
    return {
      config: [
        { reference: BULLETS, levels: levels(LevelFormat.BULLET, 1, (level) => bullets[level % 3] ?? "•") },
        ...[...this.#orderedStarts].map(([start, reference]) => ({
          reference,
          levels: levels(LevelFormat.DECIMAL, start, (level) => `%${level + 1}.`),
        })),
      ],
    };
  }

  runs(items: readonly WordInline[]): ParagraphChild[] {
    const children: ParagraphChild[] = [];
    for (const item of items) {
      if (item.type === "break") {
        children.push(new TextRun({ text: "", break: 1 }));
        continue;
      }
      const { style } = item;
      const run = new TextRun({
        text: item.text,
        bold: style.bold,
        italics: style.italic,
        strike: style.strike,
        subScript: style.subscript,
        superScript: style.superscript,
        underline: style.underline || (style.link && SAFE_LINK.test(style.link)) ? {} : undefined,
        color:
          style.link && SAFE_LINK.test(style.link)
            ? hex(color.light.accent)
            : style.muted
              ? MUTED
              : content(style.color, "text"),
        font: style.code ? CODE_FONT : undefined,
        shading: style.highlight
          ? { type: ShadingType.CLEAR, fill: content(style.highlight, "background") ?? SUNKEN, color: "auto" }
          : style.code
            ? { type: ShadingType.CLEAR, fill: SUNKEN, color: "auto" }
            : undefined,
      });
      children.push(
        style.link && SAFE_LINK.test(style.link)
          ? new ExternalHyperlink({ link: style.link, children: [run] })
          : run,
      );
    }
    return children;
  }

  async blocks(blocks: readonly WordBlock[], level = 0): Promise<FileChild[]> {
    const children: FileChild[] = [];
    for (const block of blocks) children.push(...(await this.block(block, level)));
    return children;
  }

  async block(block: WordBlock, level: number): Promise<FileChild[]> {
    switch (block.type) {
      case "paragraph":
        return [
          new Paragraph({
            children: this.runs(block.content),
            alignment:
              block.align === "center"
                ? AlignmentType.CENTER
                : block.align === "right"
                  ? AlignmentType.RIGHT
                  : block.align === "justify"
                    ? AlignmentType.JUSTIFIED
                    : undefined,
            indent: block.indent ? { left: block.indent * LIST_INDENT * 2 } : undefined,
          }),
        ];
      case "heading": {
        const index = Math.min(block.level + this.#shift, HEADINGS.length) - 1;
        return [new Paragraph({ heading: HEADINGS[index], children: this.runs(block.content) })];
      }
      case "list":
        return this.list(block.ordered, block.start, block.items, level);
      case "table":
        return [await this.table(block.rows, block.borderless)];
      case "code":
        return [
          new Paragraph({
            style: CODE_STYLE,
            children: block.text
              .split("\n")
              .map((text, index) => new TextRun({ text, break: index > 0 ? 1 : undefined })),
          }),
        ];
      case "box":
        return [await this.box(block.variant, block.title, block.content)];
      case "quote":
        return [await this.box("quote", [], block.content)];
      case "image":
        return [await this.image(block)];
      case "svg":
        return [this.svg(block)];
      case "rule":
        return [new Paragraph({ border: { bottom: line(6) }, children: [] })];
      case "contents":
        return [
          new TableOfContents(this.#document.texts.labels.tableOfContents, {
            hyperlink: true,
            headingStyleRange: `${block.minLevel}-${block.maxLevel}`,
          }),
        ];
      case "placeholder":
        return [this.note(block.text)];
    }
  }

  note(text: string): Paragraph {
    return new Paragraph({
      border: { top: line(4), bottom: line(4), left: line(4), right: line(4) },
      children: [new TextRun({ text, italics: true, color: MUTED })],
    });
  }

  async list(
    ordered: boolean,
    start: number,
    items: readonly WordListItem[],
    level: number,
  ): Promise<FileChild[]> {
    const depth = Math.min(level, MAX_LEVEL);
    let reference = BULLETS;
    if (ordered) {
      reference = this.#orderedStarts.get(start) ?? `lunedo-ordered-${start}`;
      this.#orderedStarts.set(start, reference);
    }
    this.#instance += 1;
    const instance = this.#instance;
    const children: FileChild[] = [];
    const continued = { left: LIST_INDENT * (depth + 1) };
    for (const item of items) {
      const [first, ...rest] = item.content;
      const marker =
        item.checked === null
          ? { numbering: { reference, level: depth, instance } }
          : { indent: { ...continued, hanging: LIST_INDENT } };
      const box = item.checked === null ? [] : [new TextRun({ text: item.checked ? "☑ " : "☐ " })];
      const lead = first?.type === "paragraph" ? this.runs(first.content) : [];
      children.push(new Paragraph({ ...marker, children: [...box, ...lead] }));
      for (const block of first?.type === "paragraph" ? rest : item.content) {
        children.push(
          ...(block.type === "paragraph"
            ? [new Paragraph({ indent: continued, children: this.runs(block.content) })]
            : await this.block(block, level + 1)),
        );
      }
    }
    return children;
  }

  async cell(cell: WordTableCell, borderless: boolean, width: number | null): Promise<TableCell> {
    const children = await this.blocks(cell.content);
    return new TableCell({
      columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
      rowSpan: cell.rowspan > 1 ? cell.rowspan : undefined,
      width: width === null ? undefined : { size: width, type: WidthType.PERCENTAGE },
      shading: cell.background
        ? { type: ShadingType.CLEAR, fill: content(cell.background, "background") ?? SUNKEN, color: "auto" }
        : cell.header
          ? { type: ShadingType.CLEAR, fill: SUNKEN, color: "auto" }
          : undefined,
      borders: borderless ? { top: none(), bottom: none(), left: none(), right: none() } : undefined,
      children: inCell(children),
    });
  }

  async table(rows: readonly { cells: readonly WordTableCell[] }[], borderless: boolean): Promise<Table> {
    const tableRows: TableRow[] = [];
    for (const [index, row] of rows.entries()) {
      const cells: TableCell[] = [];
      for (const cell of row.cells) {
        cells.push(await this.cell(cell, borderless, borderless ? cell.width : null));
      }
      if (cells.length === 0) continue;
      tableRows.push(
        new TableRow({
          tableHeader: index === 0 && row.cells.every((cell) => cell.header) ? true : undefined,
          cantSplit: true,
          children: cells,
        }),
      );
    }
    const border = borderless ? none() : line();
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: border,
        bottom: border,
        left: border,
        right: border,
        insideHorizontal: border,
        insideVertical: border,
      },
      rows:
        tableRows.length > 0
          ? tableRows
          : [new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [] })] })] })],
    });
  }

  async box(variant: string, title: readonly WordInline[], blocks: readonly WordBlock[]): Promise<Table> {
    const colors = BOX_COLORS[variant] ?? BOX_COLORS.neutral ?? { border: BORDER, fill: SUNKEN };
    const children = [
      ...(title.length > 0 ? [new Paragraph({ children: this.runs(title) })] : []),
      ...(await this.blocks(blocks)),
    ];
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: none(),
        bottom: none(),
        right: none(),
        left: line(24, colors.border),
        insideHorizontal: none(),
        insideVertical: none(),
      },
      rows: [
        new TableRow({
          cantSplit: false,
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, fill: colors.fill, color: "auto" },
              margins: { top: 80, bottom: 80, left: 160, right: 160 },
              borders: { top: none(), bottom: none(), right: none(), left: line(24, colors.border) },
              children: inCell(children),
            }),
          ],
        }),
      ],
    });
  }

  async image(block: Extract<WordBlock, { type: "image" }>): Promise<Paragraph> {
    const alignment =
      block.align === "left"
        ? AlignmentType.LEFT
        : block.align === "right"
          ? AlignmentType.RIGHT
          : AlignmentType.CENTER;
    const image = await this.#document.image(block.attachmentId);
    if (!image && this.#document.leftOut(block.attachmentId)) {
      return new Paragraph({
        alignment,
        border: {
          top: { style: BorderStyle.DASHED, size: 4, color: MUTED },
          bottom: { style: BorderStyle.DASHED, size: 4, color: MUTED },
          left: { style: BorderStyle.DASHED, size: 4, color: MUTED },
          right: { style: BorderStyle.DASHED, size: 4, color: MUTED },
        },
        children: [
          new TextRun({
            text: block.alt
              ? `${block.alt}: ${this.#document.texts.imageLeftOut}`
              : this.#document.texts.imageLeftOut,
            italics: true,
            color: MUTED,
          }),
        ],
      });
    }
    if (!image) {
      const label = block.alt || this.#document.texts.labels.image;
      const href = block.href && SAFE_LINK.test(block.href) ? block.href : null;
      const run = new TextRun({ text: label, italics: true, color: MUTED });
      return new Paragraph({
        alignment,
        children: [href ? new ExternalHyperlink({ link: href, children: [run] }) : run],
      });
    }
    const maximum = Math.floor(this.#textWidth * PIXELS_PER_TWIP);
    const width = Math.min(block.width ?? image.width, image.width, maximum);
    const height = Math.max(1, Math.round((image.height * width) / Math.max(1, image.width)));
    const common = {
      transformation: { width, height },
      altText: {
        name: block.alt || this.#document.texts.labels.image,
        description: block.alt,
        title: block.alt,
      },
    };
    return new Paragraph({
      alignment,
      children: [
        image.type === "svg"
          ? new ImageRun({
              ...common,
              type: "svg",
              data: image.data,
              fallback: { type: "png", data: SVG_FALLBACK },
            })
          : new ImageRun({ ...common, type: image.type, data: image.data }),
      ],
    });
  }

  svg(block: Extract<WordBlock, { type: "svg" }>): Paragraph {
    const maximum = Math.floor(this.#textWidth * PIXELS_PER_TWIP);
    const width = Math.min(block.width, maximum);
    const height = Math.max(1, Math.round((block.height * width) / Math.max(1, block.width)));
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: "svg",
          data: Buffer.from(block.svg, "utf8"),
          fallback: { type: "png", data: SVG_FALLBACK },
          transformation: { width, height },
          altText: { name: block.alt, description: block.alt, title: block.alt },
        }),
      ],
    });
  }

  muted(text: string, size?: number): Paragraph {
    return new Paragraph({ children: [new TextRun({ text, color: MUTED, size })] });
  }

  async comments(page: WordPage): Promise<FileChild[]> {
    if (!this.#document.options.comments || page.comments.length === 0) return [];
    const { texts } = this.#document;
    const children: FileChild[] = [
      new Paragraph({
        spacing: { before: 360 },
        border: { top: line() },
        children: [new TextRun({ text: texts.comments, bold: true })],
      }),
    ];
    for (const thread of page.comments) {
      if (thread.quote) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: texts.commentOn(thread.quote), italics: true, color: MUTED })],
          }),
        );
      }
      children.push(this.muted(`${thread.author} · ${thread.date}`), ...(await this.blocks(thread.body)));
      for (const reply of thread.replies) {
        children.push(
          new Paragraph({
            indent: { left: LIST_INDENT },
            children: [new TextRun({ text: `${reply.author} · ${reply.date}`, color: MUTED })],
          }),
          ...(await this.blocks(reply.body)),
        );
      }
    }
    return children;
  }

  async appendix(): Promise<FileChild[]> {
    const { attachments, texts, options } = this.#document;
    if (!options.attachments || attachments.length === 0) return [];
    const cell = (text: string, header = false) => ({
      header,
      colspan: 1,
      rowspan: 1,
      width: null,
      background: null,
      content: [
        {
          type: "paragraph" as const,
          content: [{ type: "text" as const, text, style: header ? { bold: true } : {} }],
        },
      ],
    });
    return [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: true,
        children: [new TextRun(texts.appendix)],
      }),
      await this.table(
        [
          {
            cells: [
              cell(texts.appendixFile, true),
              cell(texts.appendixPage, true),
              cell(texts.appendixSize, true),
            ],
          },
          ...attachments.map((attachment) => ({
            cells: [cell(attachment.name), cell(attachment.page), cell(attachment.size)],
          })),
        ],
        false,
      ),
    ];
  }

  async body(): Promise<FileChild[]> {
    const { pages, options, texts } = this.#document;
    const single = pages.length === 1 ? pages[0] : undefined;
    const children: FileChild[] = [];
    const front = single
      ? { path: single.path, title: single.title, meta: single.meta }
      : { path: this.#document.path, title: this.#document.title, meta: [this.#document.exported] };
    children.push(
      this.muted(front.path.join(" › ")),
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(front.title)] }),
      ...front.meta.map((meta) => this.muted(meta)),
    );
    if (options.contents) {
      children.push(
        new Paragraph({
          spacing: { before: 360 },
          children: [new TextRun({ text: texts.contents, bold: true, size: 28 })],
        }),
        new TableOfContents(texts.contents, { hyperlink: true, headingStyleRange: single ? "1-3" : "1-2" }),
        this.muted(texts.contentsHint),
      );
    }
    if (single) {
      this.#shift = 0;
      const blocks = await this.blocks(single.blocks);
      if (options.contents && blocks[0] instanceof Paragraph) {
        children.push(new Paragraph({ pageBreakBefore: true, children: [] }));
      }
      children.push(...blocks, ...(await this.comments(single)));
    } else {
      this.#shift = 1;
      for (const page of pages) {
        children.push(
          new Paragraph({
            pageBreakBefore: true,
            children: [new TextRun({ text: page.path.join(" › "), color: MUTED })],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(page.title)] }),
          ...page.meta.map((meta) => this.muted(meta)),
          ...(await this.blocks(page.blocks)),
          ...(await this.comments(page)),
        );
      }
    }
    children.push(...(await this.appendix()));
    return children;
  }

  async write(): Promise<Buffer> {
    const { options, texts } = this.#document;
    const paper = PAPER[options.paper];
    const children = await this.body();
    const headerText = [...this.#document.path, this.#document.title].join(" › ");
    const document = new Document({
      title: this.#document.title,
      creator: "Lunedo",
      styles: {
        paragraphStyles: [
          {
            id: CODE_STYLE,
            name: CODE_STYLE,
            basedOn: "Normal",
            run: { font: CODE_FONT, size: 18 },
            paragraph: {
              shading: { type: ShadingType.CLEAR, fill: SUNKEN, color: "auto" },
              border: { top: line(), bottom: line(), left: line(), right: line() },
            },
          },
        ],
      },
      features: { updateFields: options.contents },
      numbering: this.numbering,
      sections: [
        {
          properties: {
            page: {
              size: {
                width: paper.width,
                height: paper.height,
                orientation:
                  options.orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
              },
              margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
            },
          },
          headers: { default: new Header({ children: [this.muted(headerText, 16)] }) },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
                  children: [
                    new TextRun({ text: this.#document.exported, color: MUTED, size: 16 }),
                    new TextRun({
                      color: MUTED,
                      size: 16,
                      children: [
                        "\t",
                        texts.pageNumber.before,
                        PageNumber.CURRENT,
                        texts.pageNumber.between,
                        PageNumber.TOTAL_PAGES,
                      ],
                    }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    });
    return Packer.toBuffer(document);
  }
}

export function wordDocument(document: WordDocument): Promise<Buffer> {
  return new WordWriter(document).write();
}

function svgLength(value: string | undefined): number | null {
  const match = value ? /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(value) : null;
  const length = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(length) && length > 0 ? Math.round(length) : null;
}

function svgInfo(data: Buffer): Omit<WordImage, "data"> | null {
  const root = SVG_ROOT.exec(data.toString("utf8", 0, Math.min(data.length, 4096)))?.[0];
  if (!root) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(root)?.[1];
  const box = (attribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const boxWidth = box.length === 4 && (box[2] ?? 0) > 0 ? Math.round(box[2] ?? 0) : null;
  const boxHeight = box.length === 4 && (box[3] ?? 0) > 0 ? Math.round(box[3] ?? 0) : null;
  return {
    type: "svg",
    width: svgLength(attribute("width")) ?? boxWidth ?? SVG_DEFAULT_SIZE.width,
    height: svgLength(attribute("height")) ?? boxHeight ?? SVG_DEFAULT_SIZE.height,
  };
}

export function imageInfo(data: Buffer): Omit<WordImage, "data"> | null {
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString("ascii", 12, 16) === "IHDR") {
    return { type: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 10 && data.toString("ascii", 0, 3) === "GIF") {
    return { type: "gif", width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
  }
  if (data.length >= 26 && data.toString("ascii", 0, 2) === "BM") {
    return { type: "bmp", width: data.readInt32LE(18), height: Math.abs(data.readInt32LE(22)) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1] ?? 0;
      const length = data.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { type: "jpg", width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return svgInfo(data);
}
