import { ANCHOR_CONTEXT_LENGTH, MAX_QUOTE_LENGTH, type TextAnchor } from "@lunedo/editor-schema";

const BLOCKS = "p, h1, h2, h3, h4, h5, h6, pre";
const ATOMS =
  ".ld-mention, .ld-page-link, .ld-date, .ld-emoji, .ld-status, .ld-math, .ld-placeholder, .ld-template-field, .ld-task-meta";

function textNodes(block: Element): Text[] {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(ATOMS) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
  return nodes;
}

function blockOf(node: Node, container: Element): Element | null {
  const element = node instanceof Element ? node : node.parentElement;
  const block = element?.closest(BLOCKS) ?? null;
  return block && container.contains(block) ? block : null;
}

export function anchorFromSelection(container: Element): { anchor: TextAnchor; rect: DOMRect } | null {
  const selection = container.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const block = blockOf(range.startContainer, container);
  if (!block || blockOf(range.endContainer, container) !== block) return null;
  let text = "";
  let start = -1;
  let end = -1;
  for (const node of textNodes(block)) {
    if (range.intersectsNode(node)) {
      if (start === -1) start = text.length + (node === range.startContainer ? range.startOffset : 0);
      end = text.length + (node === range.endContainer ? range.endOffset : node.data.length);
    }
    text += node.data;
  }
  if (start === -1 || end <= start) return null;
  const exact = text.slice(start, end);
  if (exact.trim().length === 0 || exact.length > MAX_QUOTE_LENGTH) return null;
  return {
    anchor: {
      exact,
      prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
      suffix: text.slice(end, end + ANCHOR_CONTEXT_LENGTH),
    },
    rect: range.getBoundingClientRect(),
  };
}
