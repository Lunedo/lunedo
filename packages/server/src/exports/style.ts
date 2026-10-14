import designTokens from "@pagehall/tokens/design-tokens.json" with { type: "json" };

type ModeColors = (typeof designTokens.color)["light"];
type ContentColors = (typeof designTokens.color.content)["light"];

const { color, font, radius, space, layout } = designTokens;

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function variables(mode: ModeColors, content: ContentColors): string {
  const base = Object.entries(mode).map(([name, value]) => `--${kebab(name)}:${value};`);
  const palette = Object.entries(content).flatMap(([name, value]) => [
    `--${name}-text:${value.text};`,
    `--${name}-background:${value.background};`,
  ]);
  return [...base, ...palette].join("");
}

const contentNames = Object.keys(color.content.light);

const colorRules = contentNames
  .map(
    (name) =>
      `.ph-text-color[data-color="${name}"]{color:var(--${name}-text)}` +
      `.ph-highlight[data-color="${name}"],.ph-status[data-color="${name}"],[data-background="${name}"]{color:var(--${name}-text);background:var(--${name}-background)}`,
  )
  .join("");

const calloutRules = (
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
      `.ph-callout[data-variant="${variant}"]{border-color:var(--${tone});background:var(--${kebab(tone)}-soft)}`,
  )
  .join("");

const highlightRules = [
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

export const exportStyle = [
  `:root{color-scheme:light dark;${variables(color.light, color.content.light)}}`,
  `@media (prefers-color-scheme:dark){:root{${variables(color.dark, color.content.dark)}}}`,
  "*,*::before,*::after{box-sizing:border-box}",
  `body{margin:0;background:var(--bg);color:var(--text);font-family:${font.family.sans};font-size:${font.size.content};line-height:${font.lineHeight.content};overflow-wrap:anywhere}`,
  `main{max-width:${layout.contentWidth};margin:0 auto;padding:${space[8]} ${space[4]} ${space[12]}}`,
  `nav{margin-bottom:${space[4]};font-size:${font.size.sm}}`,
  `header{margin-bottom:${space[6]}}`,
  `header h1{margin:0 0 ${space[2]};font-size:${font.size["2xl"]};line-height:${font.lineHeight.tight}}`,
  `.ph-meta{margin:0;color:var(--text-muted);font-size:${font.size.sm}}`,
  `article>*+*,.ph-callout-content>*+*,.ph-expand>div>*+*,.ph-column>*+*,.ph-section>*+*,.ph-topic-update-content>*+*{margin-top:${space[3]}}`,
  "article>*:first-child{margin-top:0}",
  "p,ul,ol,pre,blockquote,figure,table{margin:0}",
  `h1,h2,h3,h4,h5,h6{line-height:${font.lineHeight.tight};margin:${space[6]} 0 0}`,
  `h1{font-size:${font.size["2xl"]}}h2{font-size:${font.size.xl}}h3{font-size:${font.size.lg}}h4,h5,h6{font-size:${font.size.content}}`,
  `ul,ol{padding-left:${space[6]}}`,
  "a{color:var(--accent);text-underline-offset:2px}",
  ".ph-page-link[data-access=none]{color:var(--text-muted);font-style:italic}",
  `code{font-family:${font.family.mono};font-size:${font.size.sm};background:var(--surface-sunken);border-radius:${radius.sm};padding:0 ${space[1]}}`,
  `pre{font-family:${font.family.mono};font-size:${font.size.sm};background:var(--surface-sunken);border:1px solid var(--border);border-radius:${radius.md};padding:${space[4]};overflow-x:auto}`,
  "pre code{background:none;padding:0}",
  `blockquote{border-left:4px solid var(--border);padding-left:${space[4]};color:var(--text-muted)}`,
  `hr{border:0;border-top:1px solid var(--border);margin:${space[6]} 0}`,
  "img{max-width:100%;height:auto}",
  ".ph-image{text-align:center}.ph-image[data-align=left]{text-align:left}.ph-image[data-align=right]{text-align:right}",
  `table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--border);padding:${space[1]} ${space[2]};text-align:left;vertical-align:top}th{background:var(--surface-sunken)}`,
  ".ph-table{overflow-x:auto}",
  `.ph-callout{border-left:4px solid var(--info);background:var(--info-soft);border-radius:${radius.md};padding:${space[3]} ${space[4]}}`,
  `.ph-callout-label{display:inline-flex;align-items:center;gap:${space[1]};font-weight:600}`,
  ".ph-callout-icon{width:1em;height:1em}",
  calloutRules,
  `.ph-expand{border:1px solid var(--border);border-radius:${radius.md};padding:${space[2]} ${space[3]}}.ph-expand summary{cursor:pointer;font-weight:600}`,
  `.ph-columns{display:flex;flex-wrap:wrap;gap:${space[4]}}.ph-column{flex:1 1 12rem;min-width:0}`,
  `.ph-task-list{list-style:none;padding-left:0}.ph-task-item{display:flex;gap:${space[2]};align-items:flex-start}.ph-task-item>input{margin-top:0.35em}.ph-task-item>div{flex:1;min-width:0}`,
  ".ph-task-item[data-checked=true]>div>:not(.ph-task-meta){color:var(--text-muted);text-decoration:line-through}",
  `.ph-task-meta{display:inline-flex;gap:${space[2]};margin-left:${space[2]};color:var(--text-muted);font-size:${font.size.sm}}`,
  `.ph-status{display:inline-block;border-radius:${radius.sm};padding:0 ${space[1]};font-size:${font.size.xs};font-weight:600;text-transform:uppercase}`,
  `.ph-date,.ph-mention{background:var(--surface-sunken);border-radius:${radius.sm};padding:0 ${space[1]}}`,
  colorRules,
  `.ph-decision,.ph-topic-update{border:1px solid var(--border);border-radius:${radius.md};padding:${space[3]} ${space[4]}}`,
  ".ph-decision-label,.ph-topic-update-title{font-weight:600}",
  `.ph-listing-empty,.ph-decision-source,.ph-attachment-size,.ph-unsupported-macro{color:var(--text-muted)}`,
  `.ph-unsupported-macro,.ph-export-note{border:1px dashed var(--border);border-radius:${radius.md};padding:${space[2]} ${space[3]};color:var(--text-muted)}`,
  ".ph-math .katex-html{display:none}",
  highlightRules,
  `.ph-index ul{list-style:none;padding-left:${space[5]}}.ph-index>ul{padding-left:0}.ph-index li{margin-top:${space[1]}}`,
].join("\n");
