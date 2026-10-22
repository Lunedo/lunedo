import { z } from "zod";

export const MAX_EMBED_SERVICES = 50;
export const MAX_EMBED_RULES = 20;
export const MAX_EMBED_PATTERN_LENGTH = 500;
export const EMBED_ID_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]{0,19}|\*)\}/g;
const MAX_SEGMENT_LENGTH = 300;
const KEPT_IN_SEGMENT = /%(3D|3A|40|21|24|27|28|29|2A|2B|2C|3B)/g;
const HOST_LABEL_VALUE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const QUERY_VALUE_LENGTH = 500;
const URL_PLACEHOLDER = "url";
const REST = "*";

export const EMBED_REFERRER_POLICIES = ["no-referrer", "strict-origin"] as const;

export type EmbedReferrerPolicy = (typeof EMBED_REFERRER_POLICIES)[number];

export const DEFAULT_EMBED_REFERRER_POLICY: EmbedReferrerPolicy = "no-referrer";

export interface EmbedRule {
  readonly pattern: string;
  readonly embed: string;
  readonly referrerPolicy?: EmbedReferrerPolicy;
}

export interface EmbedService {
  readonly id: string;
  readonly name: string;
  readonly rules: readonly EmbedRule[];
}

export interface ResolvedEmbed {
  readonly service: { readonly id: string; readonly name: string };
  readonly src: string;
  readonly referrerPolicy: EmbedReferrerPolicy;
}

interface ParsedPattern {
  readonly host: readonly string[];
  readonly path: readonly string[];
  readonly query: readonly [string, string][];
  readonly trailingSlash: boolean;
}

function placeholderOf(part: string): string | null {
  const match = /^\{([a-zA-Z][a-zA-Z0-9]{0,19}|\*)\}$/.exec(part);
  return match ? (match[1] as string) : null;
}

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function parsePattern(pattern: string): ParsedPattern | null {
  if (pattern.length > MAX_EMBED_PATTERN_LENGTH) return null;
  const placeholders: string[] = [];
  const stand = pattern.replace(PLACEHOLDER, (_, name: string) => {
    placeholders.push(name);
    return `ph${placeholders.length - 1}x`;
  });
  let url: URL;
  try {
    url = new URL(stand);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  const restore = (part: string) =>
    part.replace(/ph(\d+)x/g, (_, index: string) => `{${placeholders[Number(index)]}}`);
  const host = url.hostname.split(".").map(restore);
  const path = splitPath(url.pathname).map((segment) => restore(decodeURIComponent(segment)));
  const query = [...url.searchParams.entries()].map(
    ([key, value]) => [key, restore(value)] as [string, string],
  );
  return { host, path, query, trailingSlash: path.length > 0 && url.pathname.endsWith("/") };
}

function wholePlaceholdersOnly(parts: readonly string[]): boolean {
  return parts.every((part) => {
    const name = placeholderOf(part);
    return name !== null || !part.includes("{");
  });
}

function placeholdersIn(parsed: ParsedPattern): string[] {
  return [...parsed.host, ...parsed.path, ...parsed.query.map(([, value]) => value)]
    .map(placeholderOf)
    .filter((name): name is string => name !== null);
}

export function embedRuleProblem(rule: EmbedRule): string | null {
  const pattern = parsePattern(rule.pattern);
  if (!pattern) return "The address pattern must be an https address";
  const embed = parsePattern(rule.embed);
  if (!embed) return "The embed address must be an https address";
  for (const parsed of [pattern, embed]) {
    if (!wholePlaceholdersOnly([...parsed.host, ...parsed.path, ...parsed.query.map(([, value]) => value)])) {
      return "A placeholder must fill a whole part of the address";
    }
    if (
      parsed.host.some((label) => placeholderOf(label) === REST || placeholderOf(label) === URL_PLACEHOLDER)
    ) {
      return "The host can only contain named placeholders";
    }
    const fixed = parsed.host.filter((label) => placeholderOf(label) === null);
    if (fixed.length < 2 || placeholderOf(parsed.host.at(-1) ?? "") !== null) {
      return "The host must end with a fixed domain";
    }
    if (
      parsed.host.findIndex((label) => placeholderOf(label) === null) <
      parsed.host.findLastIndex((label) => placeholderOf(label) !== null)
    ) {
      return "Placeholders in the host must come before the fixed domain";
    }
  }
  const names = placeholdersIn(pattern);
  if (names.includes(URL_PLACEHOLDER)) return "{url} can only be used in the embed address";
  if (names.filter((name) => name === REST).length > 1) return "Use {*} at most once";
  if (pattern.query.some(([, value]) => placeholderOf(value) === REST))
    return "{*} can only stand in the path";
  if (new Set(names).size !== names.length) return "Each placeholder can appear only once in the pattern";
  for (const name of placeholdersIn(embed)) {
    if (name !== URL_PLACEHOLDER && !names.includes(name)) {
      return `The embed address uses {${name}}, which the pattern does not define`;
    }
  }
  if (embed.host.some((label) => placeholderOf(label) !== null && !pattern.host.includes(label))) {
    return "A placeholder in the embed host must come from the host of the pattern";
  }
  return null;
}

type Captures = Map<string, string | readonly string[]>;

function matchHost(pattern: readonly string[], host: readonly string[], captures: Captures): boolean {
  if (pattern.length !== host.length) return false;
  return pattern.every((label, index) => {
    const value = host[index] as string;
    const name = placeholderOf(label);
    if (name === null) return label === value;
    if (!HOST_LABEL_VALUE.test(value)) return false;
    captures.set(name, value);
    return true;
  });
}

function cleanValue(value: string, maximum: number): string | null {
  if (value.length === 0 || value.length > maximum || /^\.+$/.test(value)) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || value[index] === "/" || value[index] === "\\") return null;
  }
  return value;
}

function decodedSegment(raw: string): string | null {
  try {
    return cleanValue(decodeURIComponent(raw), MAX_SEGMENT_LENGTH);
  } catch {
    return null;
  }
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value).replace(KEPT_IN_SEGMENT, (escaped) => decodeURIComponent(escaped));
}

function matchSegments(pattern: readonly string[], path: readonly string[], captures: Captures): boolean {
  const rest = pattern.findIndex((segment) => placeholderOf(segment) === REST);
  if (rest === -1 ? pattern.length !== path.length : path.length < pattern.length - 1) return false;
  const after = rest === -1 ? 0 : pattern.length - rest - 1;
  const restLength = rest === -1 ? 0 : path.length - rest - after;
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index] as string;
    if (index === rest) {
      const values = path.slice(rest, rest + restLength).map(decodedSegment);
      if (values.some((value) => value === null)) return false;
      captures.set(REST, values as string[]);
      continue;
    }
    const raw = (rest !== -1 && index > rest ? path[index - 1 + restLength] : path[index]) as string;
    const value = decodedSegment(raw);
    if (value === null) return false;
    const name = placeholderOf(segment);
    if (name === null) {
      if (segment !== value) return false;
      continue;
    }
    captures.set(name, value);
  }
  return true;
}

function matchQuery(pattern: readonly [string, string][], url: URL, captures: Captures): boolean {
  return pattern.every(([key, expected]) => {
    const value = cleanValue(url.searchParams.get(key) ?? "", QUERY_VALUE_LENGTH);
    if (value === null) return false;
    const name = placeholderOf(expected);
    if (name === null) return value === expected;
    captures.set(name, value);
    return true;
  });
}

function rawSegments(url: URL): string[] {
  return splitPath(url.pathname);
}

function fill(template: ParsedPattern, captures: Captures, link: string): string {
  const value = (part: string, encode: (text: string) => string) => {
    const name = placeholderOf(part);
    if (name === null) return encode(part);
    if (name === URL_PLACEHOLDER) return encodeURIComponent(link);
    const captured = captures.get(name);
    return typeof captured === "string" ? encode(captured) : "";
  };
  const host = template.host.map((label) => value(label, (text) => text)).join(".");
  const path = template.path.flatMap((segment) => {
    const name = placeholderOf(segment);
    if (name === REST)
      return ((captures.get(REST) as readonly string[] | undefined) ?? []).map(encodeSegment);
    return [value(segment, encodeSegment)];
  });
  const query = template.query
    .map(([key, part]) => {
      const name = placeholderOf(part);
      const filled =
        name === null
          ? encodeURIComponent(part)
          : name === URL_PLACEHOLDER
            ? encodeURIComponent(link)
            : encodeURIComponent(String(captures.get(name) ?? ""));
      return `${encodeURIComponent(key)}=${filled}`;
    })
    .join("&");
  const slash = template.trailingSlash && path.length > 0 ? "/" : "";
  return `https://${host}/${path.join("/")}${slash}${query.length > 0 ? `?${query}` : ""}`;
}

export function matchEmbedRule(rule: EmbedRule, link: string): string | null {
  const pattern = parsePattern(rule.pattern);
  const embed = parsePattern(rule.embed);
  if (!pattern || !embed) return null;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const captures: Captures = new Map();
  if (!matchHost(pattern.host, url.hostname.split("."), captures)) return null;
  if (!matchSegments(pattern.path, rawSegments(url), captures)) return null;
  if (!matchQuery(pattern.query, url, captures)) return null;
  return fill(embed, captures, url.href);
}

export function resolveEmbed(link: string, services: readonly EmbedService[]): ResolvedEmbed | null {
  for (const service of services) {
    for (const rule of service.rules) {
      const src = matchEmbedRule(rule, link);
      if (src)
        return {
          service: { id: service.id, name: service.name },
          src,
          referrerPolicy: rule.referrerPolicy ?? DEFAULT_EMBED_REFERRER_POLICY,
        };
    }
  }
  return null;
}

export function embedFrameSources(services: readonly EmbedService[]): string[] {
  const sources = new Set<string>();
  for (const service of services) {
    for (const rule of service.rules) {
      const embed = parsePattern(rule.embed);
      if (!embed) continue;
      const host = embed.host.map((label) => (placeholderOf(label) === null ? label : "*"));
      const wildcard = host.lastIndexOf("*");
      const origin = wildcard === -1 ? host.join(".") : ["*", ...host.slice(wildcard + 1)].join(".");
      sources.add(`https://${origin}`);
    }
  }
  return [...sources].sort();
}

export const embedRuleValue = z
  .object({
    pattern: z.string().min(1).max(MAX_EMBED_PATTERN_LENGTH),
    embed: z.string().min(1).max(MAX_EMBED_PATTERN_LENGTH),
    referrerPolicy: z.enum(EMBED_REFERRER_POLICIES).optional(),
  })
  .strict()
  .superRefine((rule, context) => {
    const problem = embedRuleProblem(rule);
    if (problem) context.addIssue({ code: "custom", message: problem });
  });

export const embedServiceValue = z
  .object({
    id: z.string().regex(EMBED_ID_PATTERN),
    name: z.string().trim().min(1).max(100),
    rules: z.array(embedRuleValue).min(1).max(MAX_EMBED_RULES),
  })
  .strict();

export const embedServicesValue = z
  .array(embedServiceValue)
  .max(MAX_EMBED_SERVICES)
  .refine(
    (services) => new Set(services.map((service) => service.id)).size === services.length,
    "Each service may appear only once",
  );

const youtube = (pattern: string): EmbedRule => ({
  pattern,
  embed: "https://www.youtube-nocookie.com/embed/{video}",
  referrerPolicy: "strict-origin",
});

export const defaultEmbedServices: readonly EmbedService[] = [
  {
    id: "youtube",
    name: "YouTube",
    rules: [
      ...["www.youtube.com", "youtube.com", "m.youtube.com"].flatMap((host) => [
        youtube(`https://${host}/watch?v={video}`),
        youtube(`https://${host}/embed/{video}`),
        youtube(`https://${host}/shorts/{video}`),
      ]),
      youtube("https://youtu.be/{video}"),
      youtube("https://www.youtube-nocookie.com/embed/{video}"),
    ],
  },
  {
    id: "vimeo",
    name: "Vimeo",
    rules: [
      { pattern: "https://vimeo.com/{video}", embed: "https://player.vimeo.com/video/{video}?dnt=1" },
      {
        pattern: "https://vimeo.com/{video}/{hash}",
        embed: "https://player.vimeo.com/video/{video}?h={hash}&dnt=1",
      },
      {
        pattern: "https://player.vimeo.com/video/{video}",
        embed: "https://player.vimeo.com/video/{video}?dnt=1",
      },
    ],
  },
  {
    id: "loom",
    name: "Loom",
    rules: [
      { pattern: "https://www.loom.com/share/{video}", embed: "https://www.loom.com/embed/{video}" },
      { pattern: "https://www.loom.com/embed/{video}", embed: "https://www.loom.com/embed/{video}" },
    ],
  },
  {
    id: "figma",
    name: "Figma",
    rules: ["file", "design", "proto", "board", "slides"].map((kind) => ({
      pattern: `https://www.figma.com/${kind}/{file}/{*}`,
      embed: "https://www.figma.com/embed?embed_host=lunedo&url={url}",
    })),
  },
  {
    id: "miro",
    name: "Miro",
    rules: [
      {
        pattern: "https://miro.com/app/board/{board}/{*}",
        embed: "https://miro.com/app/live-embed/{board}/",
      },
      {
        pattern: "https://miro.com/app/live-embed/{board}/{*}",
        embed: "https://miro.com/app/live-embed/{board}/",
      },
    ],
  },
  {
    id: "google",
    name: "Google Docs, Slides and Sheets",
    rules: [
      {
        pattern: "https://docs.google.com/document/d/{file}/{*}",
        embed: "https://docs.google.com/document/d/{file}/preview",
      },
      {
        pattern: "https://docs.google.com/presentation/d/{file}/{*}",
        embed: "https://docs.google.com/presentation/d/{file}/embed",
      },
      {
        pattern: "https://docs.google.com/spreadsheets/d/{file}/{*}",
        embed: "https://docs.google.com/spreadsheets/d/{file}/preview",
      },
    ],
  },
  {
    id: "microsoft",
    name: "Microsoft Stream and SharePoint",
    rules: [
      {
        pattern: "https://{tenant}.sharepoint.com/{*}/_layouts/15/embed.aspx?UniqueId={file}",
        embed: "https://{tenant}.sharepoint.com/{*}/_layouts/15/embed.aspx?UniqueId={file}",
      },
      {
        pattern: "https://{tenant}.sharepoint.com/{*}/_layouts/15/Doc.aspx?sourcedoc={file}&action=embedview",
        embed: "https://{tenant}.sharepoint.com/{*}/_layouts/15/Doc.aspx?sourcedoc={file}&action=embedview",
      },
    ],
  },
];

export function narrowEmbedServices(
  services: readonly EmbedService[],
  allowed: readonly string[] | null,
): EmbedService[] {
  if (allowed === null) return [...services];
  const ids = new Set(allowed);
  return services.filter((service) => ids.has(service.id));
}
