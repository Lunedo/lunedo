import { z } from "zod";
import { type MacroConverter, type MacroImportContext, macroText, type SourceElement } from "../importing.js";
import type { ValidNode } from "../json.js";
import {
  attrOf,
  defineModule,
  type HtmlRenderer,
  type MarkdownRenderer,
  required,
  type WordRenderer,
} from "../module.js";
import { element, escapeHtml, markdownUrl } from "../text.js";
import { type ContentColor, colorValue, isIsoDate, isoDateValue, uuidValue } from "../values.js";
import { wordText } from "../word.js";
import { onlyKnownParameters } from "./reports.js";

const MAX_ROADMAP_LANES = 50;
const MAX_ROADMAP_BARS = 200;
const MAX_ROADMAP_MARKERS = 100;
const MAX_ROADMAP_ROWS = 20;
const MAX_ROADMAP_TEXT = 200;
const MAX_ROADMAP_DESCRIPTION = 2000;
const MAX_ROADMAP_DAYS = 3660;
const MAX_ROADMAP_SOURCE = 200_000;
const DAY = 86_400_000;

const text = z.string().max(MAX_ROADMAP_TEXT);

const barValue = z
  .object({
    title: text,
    description: z.string().max(MAX_ROADMAP_DESCRIPTION),
    start: isoDateValue,
    end: isoDateValue,
    row: z
      .number()
      .int()
      .min(0)
      .max(MAX_ROADMAP_ROWS - 1),
    pageId: uuidValue.nullable(),
  })
  .strict()
  .refine((bar) => bar.start <= bar.end, "A bar ends on or after its start");

const laneValue = z
  .object({ title: text, color: colorValue, bars: z.array(barValue).max(MAX_ROADMAP_BARS) })
  .strict();

const markerValue = z.object({ title: text, date: isoDateValue }).strict();

export const roadmapValue = z
  .object({
    title: text,
    start: isoDateValue,
    end: isoDateValue,
    lanes: z.array(laneValue).min(1).max(MAX_ROADMAP_LANES),
    markers: z.array(markerValue).max(MAX_ROADMAP_MARKERS),
  })
  .strict()
  .refine((roadmap) => roadmap.start < roadmap.end, "A roadmap ends after its start")
  .refine(
    (roadmap) => days(roadmap.start, roadmap.end) <= MAX_ROADMAP_DAYS,
    "A roadmap covers at most ten years",
  )
  .refine(
    (roadmap) => roadmap.lanes.reduce((count, lane) => count + lane.bars.length, 0) <= MAX_ROADMAP_BARS,
    `A roadmap has at most ${MAX_ROADMAP_BARS} bars`,
  );

export type Roadmap = z.infer<typeof roadmapValue>;
type RoadmapLane = Roadmap["lanes"][number];
type RoadmapBar = RoadmapLane["bars"][number];

type RoadmapColorRole = "background" | "text";

interface RoadmapSvgOptions {
  title: string;
  formatMonth: (iso: string) => string;
  formatDate: (iso: string) => string;
  link: (pageId: string) => string | null;
  palette?: (color: ContentColor, role: RoadmapColorRole) => string;
}

function time(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function days(start: string, end: string): number {
  return Math.round((time(end) - time(start)) / DAY);
}

function isoOf(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

const ROADMAP_WIDTH = 960;
const LABEL_WIDTH = 160;
const HEADER = 28;
const MARKER_ROW = 22;
const ROW = 30;
const LANE_PADDING = 6;
const CHARACTER = 6.6;

function shorten(value: string, width: number): string {
  const characters = Math.floor((width - 12) / CHARACTER);
  if (characters <= 1) return "";
  return value.length <= characters ? value : `${value.slice(0, Math.max(1, characters - 1))}…`;
}

function months(start: string, end: string): string[] {
  const result: string[] = [];
  const first = new Date(time(start));
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  for (;;) {
    const iso = isoOf(Date.UTC(year, month, 1));
    if (iso > end) break;
    result.push(iso);
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return result;
}

function fill(
  options: RoadmapSvgOptions,
  color: ContentColor,
  role: RoadmapColorRole,
): Record<string, string> {
  return options.palette ? { fill: options.palette(color, role) } : {};
}

function roadmapHeight(roadmap: Roadmap): number {
  return (
    HEADER +
    MARKER_ROW +
    roadmap.lanes.reduce((height, lane) => height + laneRows(lane) * ROW + LANE_PADDING * 2, 0)
  );
}

function laneRows(lane: RoadmapLane): number {
  return Math.max(1, ...lane.bars.map((bar) => bar.row + 1));
}

function roadmapSvg(roadmap: Roadmap, options: RoadmapSvgOptions): string {
  const span = Math.max(1, time(roadmap.end) - time(roadmap.start));
  const scale = (iso: string) =>
    Math.round(
      (LABEL_WIDTH +
        Math.min(Math.max(0, (time(iso) - time(roadmap.start)) / span), 1) * (ROADMAP_WIDTH - LABEL_WIDTH)) *
        10,
    ) / 10;
  const height = roadmapHeight(roadmap);
  const muted = options.palette ? { fill: options.palette("gray", "text") } : {};
  const line = options.palette ? { stroke: options.palette("gray", "background") } : {};
  const parts: string[] = [];
  const visibleMonths = months(roadmap.start, roadmap.end);
  const step = Math.max(1, Math.ceil((visibleMonths.length * 72) / (ROADMAP_WIDTH - LABEL_WIDTH)));
  for (const [index, month] of visibleMonths.entries()) {
    const x = Math.max(LABEL_WIDTH, scale(month));
    parts.push(
      element("line", { class: "ph-roadmap-grid", x1: x, x2: x, y1: HEADER - 6, y2: height, ...line }),
    );
    if (index % step === 0) {
      parts.push(
        element(
          "text",
          { class: "ph-roadmap-month", x: x + 4, y: HEADER - 10, ...muted },
          escapeHtml(options.formatMonth(month)),
        ),
      );
    }
  }
  let top = HEADER + MARKER_ROW;
  for (const lane of roadmap.lanes) {
    const laneHeight = laneRows(lane) * ROW + LANE_PADDING * 2;
    const lanes = [
      element("rect", {
        class: "ph-roadmap-lane",
        "data-color": lane.color,
        x: 0,
        y: top,
        width: ROADMAP_WIDTH,
        height: laneHeight - 2,
        rx: 4,
        "fill-opacity": options.palette ? 0.35 : null,
        ...fill(options, lane.color, "background"),
      }),
      element(
        "text",
        {
          class: "ph-roadmap-lane-title",
          "data-color": lane.color,
          x: 8,
          y: top + LANE_PADDING + ROW / 2 + 4,
          ...fill(options, lane.color, "text"),
        },
        `${element("title", {}, escapeHtml(lane.title))}${escapeHtml(shorten(lane.title, LABEL_WIDTH))}`,
      ),
    ];
    for (const bar of lane.bars) {
      const x = scale(bar.start);
      const width = Math.max(6, scale(bar.end) - x);
      const y = top + LANE_PADDING + bar.row * ROW + 2;
      const period = `${options.formatDate(bar.start)} – ${options.formatDate(bar.end)}`;
      const tooltip = [bar.title, period, bar.description].filter((part) => part.length > 0).join("\n");
      const shape = [
        element("title", {}, escapeHtml(tooltip)),
        element("rect", {
          class: "ph-roadmap-bar",
          "data-color": lane.color,
          x,
          y,
          width,
          height: ROW - 6,
          rx: 3,
          ...fill(options, lane.color, "background"),
        }),
        element(
          "text",
          {
            class: "ph-roadmap-bar-title",
            "data-color": lane.color,
            x: x + 6,
            y: y + (ROW - 6) / 2 + 4,
            ...fill(options, lane.color, "text"),
          },
          escapeHtml(shorten(bar.title, width)),
        ),
      ].join("");
      const href = bar.pageId ? options.link(bar.pageId) : null;
      lanes.push(href ? element("a", { href, class: "ph-roadmap-link" }, shape) : element("g", {}, shape));
    }
    parts.push(element("g", { class: "ph-roadmap-lane-group" }, lanes.join("")));
    top += laneHeight;
  }
  for (const marker of roadmap.markers) {
    if (marker.date < roadmap.start || marker.date > roadmap.end) continue;
    const x = scale(marker.date);
    parts.push(
      element(
        "g",
        { class: "ph-roadmap-marker" },
        `${element("title", {}, escapeHtml(`${marker.title}\n${options.formatDate(marker.date)}`))}${element("line", { x1: x, x2: x, y1: HEADER, y2: height, "stroke-dasharray": "4 3", ...(options.palette ? { stroke: options.palette("red", "text") } : {}) })}${element("text", { x: x + 4, y: HEADER + MARKER_ROW - 7, ...(options.palette ? { fill: options.palette("red", "text") } : {}) }, escapeHtml(shorten(marker.title, 160)))}`,
      ),
    );
  }
  return element(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      class: "ph-roadmap-image",
      viewBox: `0 0 ${ROADMAP_WIDTH} ${height}`,
      width: ROADMAP_WIDTH,
      height,
      role: "img",
      "aria-label": options.title,
      "font-family": "sans-serif",
      "font-size": 12,
    },
    `${element("title", {}, escapeHtml(options.title))}${parts.join("")}`,
  );
}

function monthLabel(iso: string): string {
  return iso.slice(0, 7);
}

function svgOptions(
  node: ValidNode,
  renderer: HtmlRenderer | WordRenderer | MarkdownRenderer,
): RoadmapSvgOptions {
  const roadmap = attrOf<Roadmap>(node, "roadmap");
  return {
    title: roadmap.title || renderer.label("roadmap"),
    formatMonth: renderer.context.formatMonth ?? monthLabel,
    formatDate: (iso) => renderer.formatDate(iso),
    link: (pageId) => {
      const resolved = renderer.pageLink({ pageId, spaceId: null, title: null });
      return resolved?.accessible ? renderer.safeHref(resolved.href) : null;
    },
    ...(renderer.context.svgPalette ? { palette: renderer.context.svgPalette } : {}),
  };
}

interface RoadmapEntry {
  title: string;
  detail: string;
  href: string | null;
  children: RoadmapEntry[];
}

function roadmapEntries(roadmap: Roadmap, options: RoadmapSvgOptions): RoadmapEntry[] {
  return [
    ...roadmap.lanes.map((lane) => ({
      title: lane.title,
      detail: "",
      href: null,
      children: lane.bars.map((bar) => ({
        title: bar.title,
        detail: `${options.formatDate(bar.start)} – ${options.formatDate(bar.end)}`,
        href: bar.pageId ? options.link(bar.pageId) : null,
        children: [],
      })),
    })),
    ...roadmap.markers.map((marker) => ({
      title: marker.title,
      detail: options.formatDate(marker.date),
      href: null,
      children: [],
    })),
  ];
}

function entriesHtml(entries: readonly RoadmapEntry[], renderer: HtmlRenderer): string {
  return element(
    "ul",
    {},
    entries
      .map((entry) => {
        const title = renderer.escape(entry.title);
        const name = entry.href ? element("a", { href: entry.href }, title) : title;
        const detail = entry.detail ? ` (${renderer.escape(entry.detail)})` : "";
        const children = entry.children.length > 0 ? entriesHtml(entry.children, renderer) : "";
        return element("li", {}, `${name}${detail}${children}`);
      })
      .join(""),
  );
}

function roadmapHtml(node: ValidNode, renderer: HtmlRenderer): string {
  const roadmap = attrOf<Roadmap>(node, "roadmap");
  const options = svgOptions(node, renderer);
  const caption = `${roadmap.title ? `${element("strong", {}, renderer.escape(roadmap.title))} · ` : ""}${renderer.escape(renderer.label("roadmapReadOnly"))}`;
  const list = element(
    "details",
    { class: "ph-roadmap-list" },
    `${element("summary", {}, renderer.escape(renderer.label("roadmapAsList")))}${entriesHtml(roadmapEntries(roadmap, options), renderer)}`,
  );
  return element(
    "figure",
    { class: "ph-roadmap" },
    `${element("div", { class: "ph-roadmap-scroll" }, roadmapSvg(roadmap, options))}${element("figcaption", {}, caption)}${list}`,
  );
}

function entriesMarkdown(entries: readonly RoadmapEntry[], renderer: MarkdownRenderer, level = 0): string[] {
  return entries.flatMap((entry) => {
    const title = renderer.escape(entry.title);
    const name = entry.href ? `[${title}](${markdownUrl(entry.href)})` : title;
    const detail = entry.detail ? ` (${renderer.escape(entry.detail)})` : "";
    return [
      `${"  ".repeat(level)}- ${name}${detail}`,
      ...entriesMarkdown(entry.children, renderer, level + 1),
    ];
  });
}

function roadmapMarkdown(node: ValidNode, renderer: MarkdownRenderer): string {
  const roadmap = attrOf<Roadmap>(node, "roadmap");
  const options = svgOptions(node, renderer);
  const caption = `${roadmap.title ? `**${renderer.escape(roadmap.title)}** · ` : ""}${renderer.escape(renderer.label("roadmapReadOnly"))}`;
  return [
    caption,
    "",
    `<details><summary>${escapeHtml(renderer.label("roadmapAsList"))}</summary>`,
    "",
    ...entriesMarkdown(roadmapEntries(roadmap, options), renderer),
    "",
    "</details>",
  ].join("\n");
}

const CONFLUENCE_COLORS: readonly [string, ContentColor][] = [
  ["#f6c342", "yellow"],
  ["#fadb8e", "yellow"],
  ["#3b7fc4", "blue"],
  ["#6c9fd3", "blue"],
  ["#d04437", "red"],
  ["#f691b2", "pink"],
  ["#8eb021", "green"],
  ["#14892c", "green"],
  ["#654982", "purple"],
  ["#815b3a", "orange"],
  ["#f79232", "orange"],
  ["#59afe1", "teal"],
  ["#999999", "gray"],
  ["#707070", "gray"],
];

function rgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function nearestColor(hex: unknown): ContentColor {
  const target = typeof hex === "string" ? rgb(hex) : null;
  if (!target) return "blue";
  let best: ContentColor = "blue";
  let distance = Number.POSITIVE_INFINITY;
  for (const [candidate, color] of CONFLUENCE_COLORS) {
    const value = rgb(candidate) as [number, number, number];
    const current = value.reduce((sum, channel, index) => sum + (channel - (target[index] ?? 0)) ** 2, 0);
    if (current < distance) {
      distance = current;
      best = color;
    }
  }
  return best;
}

function dateOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iso = value.trim().slice(0, 10);
  return isIsoDate(iso) ? iso : null;
}

function plusUnits(start: string, duration: number, unit: string): string {
  const begin = time(start);
  if (unit === "WEEK") return isoOf(begin + Math.round(duration * 7) * DAY);
  const date = new Date(begin);
  const whole = Math.floor(duration);
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + whole, date.getUTCDate());
  const following = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + whole + 1, date.getUTCDate());
  return isoOf(next + Math.round((duration - whole) * ((following - next) / DAY)) * DAY);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";
}

function barLink(value: unknown, context: MacroImportContext): string | null {
  const link = record(value);
  if (!link) return null;
  const id = typeof link.id === "string" || typeof link.id === "number" ? String(link.id) : "";
  if (/^\d{1,19}$/.test(id)) {
    const pageId = context.pageById(id);
    if (pageId) return pageId;
  }
  const wiki =
    typeof link.wikiLink === "string" ? /^\[?(?:([^:\]]+):)?([^\]]+)\]?$/.exec(link.wikiLink.trim()) : null;
  const title = textOf(link.title, 255) || textOf(wiki?.[2], 255);
  if (title.length === 0) return null;
  const spaceKey = textOf(link.spaceKey, 255) || textOf(wiki?.[1], 255) || null;
  const attributes: Record<string, string> = { "ri:content-title": title };
  if (spaceKey) attributes["ri:space-key"] = spaceKey;
  const pageId = context.page({ name: "ri:page", attributes, children: [] });
  if (!pageId) context.note({ code: "externalPageLink", title, spaceKey });
  return pageId;
}

function decodedSource(macro: SourceElement): Record<string, unknown> | null {
  const source = macroText(macro, "source") ?? "";
  if (source.length === 0 || source.length > MAX_ROADMAP_SOURCE) return null;
  try {
    return record(JSON.parse(source.startsWith("%") ? decodeURIComponent(source) : source));
  } catch {
    return null;
  }
}

function roadmapFrom(macro: SourceElement, context: MacroImportContext): Roadmap | null {
  const source = decodedSource(macro);
  const timeline = record(source?.timeline);
  if (!source || !timeline) return null;
  const start = dateOf(timeline.startDate);
  const end = dateOf(timeline.endDate);
  const unit = textOf(timeline.displayOption, 20).toUpperCase() || "MONTH";
  if (!start || !end || (unit !== "MONTH" && unit !== "WEEK")) return null;
  const lanes = Array.isArray(source.lanes) ? source.lanes : [];
  const roadmap: Roadmap = {
    title: textOf(source.title, MAX_ROADMAP_TEXT),
    start,
    end,
    lanes: [],
    markers: [],
  };
  for (const entry of lanes) {
    const lane = record(entry);
    if (!lane) return null;
    const bars: RoadmapBar[] = [];
    for (const item of Array.isArray(lane.bars) ? lane.bars : []) {
      const bar = record(item);
      const barStart = dateOf(bar?.startDate);
      const duration = typeof bar?.duration === "number" ? bar.duration : Number.NaN;
      const row = typeof bar?.rowIndex === "number" ? bar.rowIndex : 0;
      if (!bar || !barStart || !Number.isFinite(duration) || duration < 0 || !Number.isInteger(row))
        return null;
      if (row < 0 || row >= MAX_ROADMAP_ROWS) return null;
      bars.push({
        title: textOf(bar.title, MAX_ROADMAP_TEXT),
        description:
          typeof bar.description === "string" ? bar.description.slice(0, MAX_ROADMAP_DESCRIPTION) : "",
        start: barStart,
        end: plusUnits(barStart, Math.min(duration, 520), unit),
        row,
        pageId: barLink(bar.pageLink, context),
      });
    }
    roadmap.lanes.push({
      title: textOf(lane.title, MAX_ROADMAP_TEXT),
      color: nearestColor(record(lane.color)?.lane),
      bars,
    });
  }
  for (const entry of Array.isArray(source.markers) ? source.markers : []) {
    const marker = record(entry);
    const date = dateOf(marker?.markerDate);
    if (!marker || !date) return null;
    roadmap.markers.push({ title: textOf(marker.title, MAX_ROADMAP_TEXT), date });
  }
  return roadmapValue.safeParse(roadmap).success ? roadmap : null;
}

const roadmapImporter: MacroConverter = {
  source: "confluence",
  macros: ["roadmap"],
  convert: (macro, context) => {
    if (
      !onlyKnownParameters(macro, new Set(["source", "title", "timeline", "maplinks", "pagelinks", "hash"]))
    ) {
      return null;
    }
    const roadmap = roadmapFrom(macro, context);
    return roadmap ? [{ type: "roadmap", attrs: { roadmap } }] : null;
  },
};

export const roadmapModule = defineModule({
  name: "roadmap",
  nodes: [
    {
      name: "roadmap",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: { roadmap: required(roadmapValue) },
      html: roadmapHtml,
      word: (node, renderer) => {
        const roadmap = attrOf<Roadmap>(node, "roadmap");
        const options = svgOptions(node, renderer);
        return [
          {
            type: "svg",
            svg: roadmapSvg(roadmap, options),
            alt: options.title,
            width: ROADMAP_WIDTH,
            height: roadmapHeight(roadmap),
          },
          {
            type: "paragraph",
            content: [wordText(renderer.label("roadmapReadOnly"), { muted: true, italic: true })],
          },
        ];
      },
      markdown: roadmapMarkdown,
      text: (node) => {
        const roadmap = attrOf<Roadmap>(node, "roadmap");
        return [
          roadmap.title,
          ...roadmap.lanes.flatMap((lane) => [
            lane.title,
            ...lane.bars.flatMap((bar) => [bar.title, bar.description]),
          ]),
          ...roadmap.markers.map((marker) => marker.title),
        ]
          .filter((part) => part.length > 0)
          .join("\n");
      },
    },
  ],
  importers: [roadmapImporter],
});
