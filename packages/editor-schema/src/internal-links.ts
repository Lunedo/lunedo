const ITEM_ADDRESS =
  /^\/(?:spaces\/[^/?#]+\/(?:pages|blog|whiteboards|folders)|shared)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/[^?#]*)?(?:\?[^#]*)?(#.*)?$/i;

export interface InternalItemLink {
  itemId: string;
  fragment: string;
}

export function internalItemLink(href: string): InternalItemLink | null {
  const match = ITEM_ADDRESS.exec(href);
  if (!match?.[1]) return null;
  return { itemId: match[1].toLowerCase(), fragment: match[2] ?? "" };
}
