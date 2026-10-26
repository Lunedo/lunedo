import { slugify } from "@lunedo/editor-schema";

const ADDRESS_SEGMENTS: Readonly<Record<string, string>> = {
  page: "pages",
  folder: "folders",
  blogPost: "blog",
  whiteboard: "whiteboards",
  meetingSeries: "meetings",
  meetingTopic: "topics",
};

const SHARED_KINDS: ReadonlySet<string> = new Set(["page", "blogPost", "whiteboard"]);

function withSlug(path: string, title: string): string {
  const slug = slugify(title);
  return slug ? `${path}/${slug}` : path;
}

export function itemAddress(
  kind: string,
  spaceKey: string,
  number: number | string,
  title: string,
): string | null {
  const segment = Object.hasOwn(ADDRESS_SEGMENTS, kind) ? ADDRESS_SEGMENTS[kind] : undefined;
  if (!segment) return null;
  if (!spaceKey) return SHARED_KINDS.has(kind) ? withSlug(`/shared/${Number(number)}`, title) : null;
  return withSlug(`/spaces/${encodeURIComponent(spaceKey)}/${segment}/${Number(number)}`, title);
}
