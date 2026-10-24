export const INTRODUCTION_MAX_LENGTH = 1000;

export type IntroductionInline =
  | { type: "text"; text: string; bold: boolean; italic: boolean }
  | { type: "link"; text: string; href: string }
  | { type: "break" };

export interface IntroductionBlock {
  type: "paragraph" | "callout";
  content: IntroductionInline[];
}

const SAFE_LINK = /^(https?:\/\/[^\s<>"]+|mailto:[^\s<>"@]+@[^\s<>"]+)$/i;
const TOKEN = /\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*|_([^_\n]+?)_|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function inlineOf(line: string): IntroductionInline[] {
  const result: IntroductionInline[] = [];
  const text = (value: string, bold = false, italic = false) => {
    if (value) result.push({ type: "text", text: value, bold, italic });
  };
  let last = 0;
  for (const match of line.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    text(line.slice(last, index));
    const [whole, bold, star, underscore, label, href] = match;
    if (bold !== undefined) text(bold, true);
    else if (star !== undefined) text(star, false, true);
    else if (underscore !== undefined) text(underscore, false, true);
    else if (label !== undefined && href !== undefined && SAFE_LINK.test(href)) {
      result.push({ type: "link", text: label, href });
    } else text(whole);
    last = index + whole.length;
  }
  text(line.slice(last));
  return result;
}

function contentOf(lines: string[]): IntroductionInline[] {
  return lines.flatMap((line, index) => [
    ...(index > 0 ? [{ type: "break" } as const] : []),
    ...inlineOf(line.trim()),
  ]);
}

export function parseIntroduction(source: string): IntroductionBlock[] {
  const blocks: IntroductionBlock[] = [];
  let callout = false;
  for (const chunk of source.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    const quoted = lines.every((line) => /^\s*>/.test(line));
    const stripped = quoted ? lines.map((line) => line.replace(/^\s*>\s?/, "")) : lines;
    const type = quoted && !callout ? "callout" : "paragraph";
    if (type === "callout") callout = true;
    const content = contentOf(stripped);
    if (content.length > 0) blocks.push({ type, content });
  }
  return blocks;
}

export function introductionText(source: string): string {
  return parseIntroduction(source)
    .map((block) => block.content.map((inline) => (inline.type === "break" ? " " : inline.text)).join(""))
    .join(" ");
}
