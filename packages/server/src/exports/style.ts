import designTokens from "@lunedo/tokens/design-tokens.json" with { type: "json" };
import type { Orientation, PaperSize } from "./options.js";

type ModeColors = (typeof designTokens.color)["light"];
type ContentColors = (typeof designTokens.color.content)["light"];

const { color, font, radius, space, layout } = designTokens;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function variables(mode: ModeColors, content: ContentColors): string {
  const base = Object.entries(mode).map(([name, value]) => `--${kebab(name)}:${value};`);
  const palette = Object.entries(content).flatMap(([name, value]) => [
    `--${name}-text:${value.text};`,
    `--${name}-background:${value.background};`,
  ]);
  return [...base, ...palette].join("");
}

const contentNames = Object.keys(color.content.light);

export const colorRules = contentNames
  .map(
    (name) =>
      `.ld-text-color[data-color="${name}"]{color:var(--${name}-text)}` +
      `.ld-highlight[data-color="${name}"],.ld-status[data-color="${name}"],[data-background="${name}"]{color:var(--${name}-text);background:var(--${name}-background)}`,
  )
  .join("");

export const calloutRules = (
  [
    ["info", "info"],
    ["tip", "success"],
    ["note", "info"],
    ["warning", "warning"],
    ["error", "danger"],
  ] as const
)
  .map(
    ([variant, tone]) =>
      `.ld-callout[data-variant="${variant}"]{border-color:var(--${tone});background:var(--${kebab(tone)}-soft)}`,
  )
  .join("");

export const highlightRules = [
  [".hljs-comment,.hljs-quote", "color:var(--text-muted);font-style:italic"],
  [".hljs-keyword,.hljs-selector-tag,.hljs-built_in,.hljs-doctag", "color:var(--purple-text)"],
  [".hljs-string,.hljs-regexp,.hljs-addition,.hljs-attribute", "color:var(--green-text)"],
  [".hljs-number,.hljs-literal,.hljs-symbol,.hljs-bullet", "color:var(--orange-text)"],
  [".hljs-title,.hljs-section,.hljs-name,.hljs-selector-id,.hljs-selector-class", "color:var(--blue-text)"],
  [".hljs-variable,.hljs-template-variable,.hljs-attr,.hljs-type,.hljs-params", "color:var(--teal-text)"],
  [".hljs-deletion", "color:var(--red-text)"],
  [".hljs-meta", "color:var(--gray-text)"],
]
  .map(([selector, rule]) => `${selector}{${rule}}`)
  .join("");

const contentRules = [
  `.ld-meta{margin:0;color:var(--text-muted);font-size:${font.size.sm}}`,
  `article>*+*,.ld-callout-content>*+*,.ld-expand>div>*+*,.ld-column>*+*,.ld-section>*+*,.ld-topic-update-content>*+*{margin-top:${space[3]}}`,
  "article>*:first-child{margin-top:0}",
  "p,ul,ol,pre,blockquote,figure,table{margin:0}",
  `h1,h2,h3,h4,h5,h6{line-height:${font.lineHeight.tight};margin:${space[6]} 0 0}`,
  `h1{font-size:${font.size["2xl"]}}h2{font-size:${font.size.xl}}h3{font-size:${font.size.lg}}h4,h5,h6{font-size:${font.size.content}}`,
  `ul,ol{padding-left:${space[6]}}`,
  "a{color:var(--accent);text-underline-offset:2px}",
  ".ld-page-link[data-access=none]{color:var(--text-muted);font-style:italic}",
  `code{font-family:${font.family.mono};font-size:${font.size.sm};background:var(--surface-sunken);border-radius:${radius.sm};padding:0 ${space[1]}}`,
  `pre{font-family:${font.family.mono};font-size:${font.size.sm};background:var(--surface-sunken);border:1px solid var(--border);border-radius:${radius.md};padding:${space[4]};overflow-x:auto}`,
  "pre code{background:none;padding:0}",
  `blockquote{border-left:4px solid var(--border);padding-left:${space[4]};color:var(--text-muted)}`,
  `hr{border:0;border-top:1px solid var(--border);margin:${space[6]} 0}`,
  "img{max-width:100%;height:auto}",
  ".ld-image{text-align:center}.ld-image[data-align=left]{text-align:left}.ld-image[data-align=right]{text-align:right}",
  Array.from(
    { length: 100 },
    (_, index) => `.ld-image[data-width="${index + 1}"] img{width:${index + 1}%}`,
  ).join(""),
  ".ld-whiteboard{text-align:center}",
  `table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--border);padding:${space[1]} ${space[2]};text-align:left;vertical-align:top}th{background:var(--surface-sunken)}`,
  ".ld-table{overflow-x:auto}",
  `.ld-callout{border-left:4px solid var(--info);background:var(--info-soft);border-radius:${radius.md};padding:${space[3]} ${space[4]}}`,
  `.ld-callout-label{display:inline-flex;align-items:center;gap:${space[1]};font-weight:600}`,
  ".ld-callout-icon{width:1em;height:1em}",
  calloutRules,
  `.ld-expand{border:1px solid var(--border);border-radius:${radius.md};padding:${space[2]} ${space[3]}}.ld-expand summary{cursor:pointer;font-weight:600}`,
  `.ld-columns{display:flex;flex-wrap:wrap;gap:${space[4]}}.ld-column{flex:1 1 12rem;min-width:0}`,
  `.ld-task-list{list-style:none;padding-left:0}.ld-task-item{display:flex;gap:${space[2]};align-items:flex-start}.ld-task-item>input{margin-top:0.35em}.ld-task-item>div{flex:1;min-width:0}`,
  ".ld-task-item[data-checked=true]>div>:not(.ld-task-meta){color:var(--text-muted);text-decoration:line-through}",
  `.ld-task-meta{display:inline-flex;gap:${space[2]};margin-left:${space[2]};color:var(--text-muted);font-size:${font.size.sm}}`,
  `.ld-status{display:inline-block;border-radius:${radius.sm};padding:0 ${space[1]};font-size:${font.size.xs};font-weight:600;text-transform:uppercase}`,
  `.ld-date,.ld-mention{background:var(--surface-sunken);border-radius:${radius.sm};padding:0 ${space[1]}}`,
  colorRules,
  `.ld-decision,.ld-topic-update{border:1px solid var(--border);border-radius:${radius.md};padding:${space[3]} ${space[4]}}`,
  ".ld-decision-label,.ld-topic-update-title{font-weight:600}",
  `.ld-listing-empty,.ld-decision-source,.ld-attachment-size,.ld-unsupported-macro{color:var(--text-muted)}`,
  `.ld-unsupported-macro,.ld-export-note{border:1px dashed var(--border);border-radius:${radius.md};padding:${space[2]} ${space[3]};color:var(--text-muted)}`,
  ".ld-math .katex-html{display:none}",
  highlightRules,
  `.ld-index ul{list-style:none;padding-left:${space[5]}}.ld-index>ul{padding-left:0}.ld-index li{margin-top:${space[1]}}`,
  `.ld-unavailable{border:1px dashed var(--border);border-radius:${radius.md};padding:${space[2]} ${space[3]};color:var(--text-muted)}`,
  ".ld-page-properties th{width:30%}",
  `.ld-listing-meta,.ld-listing-more{color:var(--text-muted);font-size:${font.size.sm}}.ld-listing-meta{margin-left:${space[2]}}`,
  `.ld-label-list{display:flex;flex-wrap:wrap;gap:${space[2]};list-style:none;padding-left:0}`,
  `section.ld-include{border:1px solid var(--border);border-radius:${radius.md};padding:${space[3]} ${space[4]}}.ld-include-title{font-weight:600}`,
  ".ld-include-note{color:var(--text-muted);font-style:italic}",
  `.ld-embed figcaption,.ld-file-preview figcaption,.ld-whiteboard figcaption{margin-top:${space[1]};overflow-wrap:anywhere}`,
  ".ld-file-preview{text-align:center}",
  `.ld-tabs>.ld-tab+.ld-tab{margin-top:${space[4]}}.ld-tab>*+*{margin-top:${space[3]}}`,
  ".ld-heading-number{color:var(--text-muted)}",
  `.ld-roadmap svg{max-width:100%;height:auto}.ld-roadmap figcaption{color:var(--text-muted);font-size:${font.size.sm}}`,
  ".ld-roadmap-grid{stroke:var(--border)}.ld-roadmap-month{fill:var(--text-muted)}.ld-roadmap-marker line{stroke:var(--red-text)}.ld-roadmap-marker text{fill:var(--red-text)}",
  contentNames
    .map(
      (name) =>
        `.ld-roadmap-lane[data-color="${name}"]{fill:var(--${name}-background);fill-opacity:.35}` +
        `.ld-roadmap-bar[data-color="${name}"]{fill:var(--${name}-background)}` +
        `:is(.ld-roadmap-lane-title,.ld-roadmap-bar-title)[data-color="${name}"]{fill:var(--${name}-text)}`,
    )
    .join(""),
];

export const exportStyle = [
  `:root{color-scheme:light dark;${variables(color.light, color.content.light)}}`,
  `@media (prefers-color-scheme:dark){:root{${variables(color.dark, color.content.dark)}}}`,
  "*,*::before,*::after{box-sizing:border-box}",
  `body{margin:0;background:var(--bg);color:var(--text);font-family:${font.family.sans};font-size:${font.size.content};line-height:${font.lineHeight.content};overflow-wrap:anywhere}`,
  `main{max-width:${layout.contentWidth};margin:0 auto;padding:${space[8]} ${space[4]} ${space[12]}}`,
  `nav{margin-bottom:${space[4]};font-size:${font.size.sm}}`,
  `header{margin-bottom:${space[6]}}`,
  `header h1{margin:0 0 ${space[2]};font-size:${font.size["2xl"]};line-height:${font.lineHeight.tight}}`,
  ...contentRules,
].join("\n");

export interface PrintStyleOptions {
  paper: PaperSize;
  orientation: Orientation;
  pageNumber: { before: string; between: string };
  footer: string;
}

const PAPER: Record<PaperSize, string> = { a4: "A4", letter: "letter" };

export function cssString(text: string): string {
  return `"${text.replace(/["\\]/g, "\\$&").replace(/\s+/g, " ")}"`;
}

export function printStyle(options: PrintStyleOptions): string {
  const margin = `font-family:${font.family.sans};font-size:${font.size.xs};color:${color.light.textMuted}`;
  return [
    `@page{size:${PAPER[options.paper]} ${options.orientation};margin:18mm 16mm 20mm;` +
      `@top-left{content:string(ld-path) " \\203A  " string(ld-title);${margin}}` +
      `@bottom-left{content:${cssString(options.footer)};${margin}}` +
      `@bottom-right{content:${cssString(options.pageNumber.before)} counter(page) ${cssString(options.pageNumber.between)} counter(pages);${margin}}}`,
    "@page :first{@top-left{content:none}}",
    `:root{color-scheme:light;${variables(color.light, color.content.light)}}`,
    "*,*::before,*::after{box-sizing:border-box}",
    `body{margin:0;background:var(--bg);color:var(--text);font-family:${font.family.sans};font-size:${font.size.content};line-height:${font.lineHeight.content};overflow-wrap:anywhere}`,
    ...contentRules,
    ".ld-roadmap-list{display:none}",
    `.ld-front{margin-bottom:${space[6]}}`,
    `.ld-path{margin:0 0 ${space[1]};color:var(--text-muted);font-size:${font.size.sm}}`,
    `.ld-document-title,.ld-page-title{margin:0 0 ${space[2]};font-size:${font.size["2xl"]};line-height:${font.lineHeight.tight}}`,
    ".ld-front .ld-path{string-set:ld-path content(text)}",
    ".ld-front .ld-document-title{string-set:ld-title content(text)}",
    ".ld-print-page>.ld-title-block .ld-path{string-set:ld-path content(text)}",
    ".ld-print-page>.ld-title-block .ld-page-title{string-set:ld-title content(text)}",
    `.ld-title-block{margin-bottom:${space[6]}}`,
    ".ld-print-page,.ld-appendix{break-before:page}",
    `.ld-contents{margin-top:${space[8]}}`,
    `.ld-contents h2{margin:0 0 ${space[3]};font-size:${font.size.xl}}`,
    `.ld-contents ol{list-style:none;margin:0;padding:0}.ld-contents li{margin-top:${space[1]}}`,
    `.ld-contents a{display:flex;gap:${space[2]};color:var(--text);text-decoration:none}`,
    ".ld-contents .ld-entry{flex:1;min-width:0}",
    ".ld-contents a::after{content:target-counter(attr(href url),page)}",
    ...[1, 2, 3, 4, 5].map(
      (level) => `.ld-contents li[data-level="${level}"]{padding-left:calc(${level} * ${space[5]})}`,
    ),
    "a{text-decoration:none}",
    "h1,h2,h3,h4,h5,h6{break-after:avoid}",
    "figure,.ld-callout,.ld-decision,.ld-comment-thread,tr{break-inside:avoid}",
    "thead{display:table-header-group}",
    "pre{white-space:pre-wrap;overflow:visible}",
    ".ld-table{overflow:visible}",
    ".ld-expand-title{font-weight:600}",
    ".ld-whiteboard img{max-height:150mm}",
    `.ld-comments{margin-top:${space[8]};border-top:1px solid var(--border);padding-top:${space[4]}}`,
    `.ld-comments h2{font-size:${font.size.lg};margin:0 0 ${space[3]}}`,
    `.ld-comment-thread{border-left:3px solid var(--border);padding-left:${space[3]};margin-top:${space[4]}}`,
    `.ld-comment-reply{margin-left:${space[4]};margin-top:${space[2]}}`,
    `.ld-comment-quote{color:var(--text-muted);font-style:italic}`,
    `.ld-comment-meta{color:var(--text-muted);font-size:${font.size.sm}}`,
    `.ld-appendix h2{font-size:${font.size.xl};margin:0 0 ${space[3]}}`,
  ].join("\n");
}
