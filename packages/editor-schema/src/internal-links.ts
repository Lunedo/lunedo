const ITEM_PATH =
  /^\/(?:spaces\/[^/?#]+\/(?:pages|blog|whiteboards|folders)|shared)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/[^?#]*)?(?:\?[^#]*)?(#.*)?$/i;
const ABSOLUTE = /^https?:\/\/[^/?#]+(\/.*)$/i;

const ADDRESSED_ITEM =
  /^\/(?:spaces\/[^/?#]+\/(?:pages|blog|whiteboards|folders|meetings|topics)|shared)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]{1,15})(?=$|[/?#])[^?#]*(\?[^#]*)?(#.*)?$/i;

export type ItemReference = { id: string } | { number: number };

export interface ItemAddress {
  reference: ItemReference;
  query: string;
  fragment: string;
}

export interface InternalItemLink {
  itemId: string;
  fragment: string;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

function pathOf(href: string, instanceUrl: string | undefined): string | null {
  if (href.startsWith("/")) return href;
  const absolute = ABSOLUTE.exec(href);
  if (!absolute?.[1] || instanceUrl === undefined) return null;
  const origin = originOf(instanceUrl);
  return origin !== null && originOf(href) === origin ? absolute[1] : null;
}

function itemLinkIn(path: string | null): InternalItemLink | null {
  const match = path ? ITEM_PATH.exec(path) : null;
  if (!match?.[1]) return null;
  return { itemId: match[1].toLowerCase(), fragment: match[2] ?? "" };
}

export function internalItemLink(href: string, instanceUrl?: string): InternalItemLink | null {
  return itemLinkIn(pathOf(href, instanceUrl));
}

export function linkedItemId(href: string): string | null {
  return itemLinkIn(href.startsWith("/") ? href : (ABSOLUTE.exec(href)?.[1] ?? null))?.itemId ?? null;
}

export function itemAddressOf(href: string, instanceUrl?: string): ItemAddress | null {
  const match = ADDRESSED_ITEM.exec(pathOf(href, instanceUrl) ?? "");
  if (!match?.[1]) return null;
  const reference = match[1].includes("-") ? { id: match[1].toLowerCase() } : { number: Number(match[1]) };
  return { reference, query: match[2] ?? "", fragment: match[3] ?? "" };
}
