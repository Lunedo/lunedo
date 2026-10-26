const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

export function htmlAttributes(
  attributes: Record<string, string | number | boolean | null | undefined>,
): string {
  let result = "";
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    result += value === true ? ` ${name}` : ` ${name}="${escapeHtml(String(value))}"`;
  }
  return result;
}

export function element(
  name: string,
  attributes: Record<string, string | number | boolean | null | undefined>,
  content = "",
): string {
  return `<${name}${htmlAttributes(attributes)}>${content}</${name}>`;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>|~$&]/g, "\\$&");
}

export function escapeLineStart(line: string): string {
  if (/^(#|[-+=]\s|[-+=]$|\d+[.)])/.test(line)) {
    return line.replace(/^(\d+)([.)])/, "$1\\$2").replace(/^([#\-+=])/, "\\$1");
  }
  return line;
}

export function prefixLines(text: string, first: string, rest: string = " ".repeat(first.length)): string {
  return text
    .split("\n")
    .map((line, index) => {
      const prefix = index === 0 ? first : rest;
      return line.length === 0 ? prefix.trimEnd() : prefix + line;
    })
    .join("\n");
}

export function fenceFor(content: string, character: "`" | "~" = "`"): string {
  let longest = 0;
  const run = new RegExp(`\\${character}+`, "g");
  for (const match of content.matchAll(run)) longest = Math.max(longest, match[0].length);
  return character.repeat(Math.max(3, longest + 1));
}

export function inlineCode(content: string): string {
  let longest = 0;
  for (const match of content.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const ticks = "`".repeat(longest + 1);
  const padded = content.startsWith("`") || content.endsWith("`") ? ` ${content} ` : content;
  return `${ticks}${padded}${ticks}`;
}

export function wrapDelimited(content: string, delimiter: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  const [, leading = "", inner = "", trailing = ""] = match ?? [];
  if (inner.length === 0) return content;
  return `${leading}${delimiter}${inner}${delimiter}${trailing}`;
}

export function markdownUrl(href: string): string {
  return href.replace(/[\s()<>]/g, (character) => encodeURIComponent(character));
}

const SLUG_LETTERS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  Ä: "Ae",
  Ö: "Oe",
  Ü: "Ue",
  ß: "ss",
  ẞ: "SS",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ł: "l",
  Ł: "L",
  ħ: "h",
  Ħ: "H",
  ı: "i",
};

const MAX_SLUG_LENGTH = 80;

export function slugify(text: string): string {
  const slug = text
    .normalize("NFC")
    .replace(/[äöüÄÖÜßẞøØđĐłŁħĦı]/gu, (letter) => SLUG_LETTERS[letter] ?? letter)
    .toLowerCase()
    .normalize("NFD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^[-\p{M}]+|-+$/gu, "");
  const characters = Array.from(slug);
  if (characters.length <= MAX_SLUG_LENGTH) return slug;
  const cut = characters.slice(0, MAX_SLUG_LENGTH).join("");
  if (characters[MAX_SLUG_LENGTH] === "-") return cut;
  const hyphen = cut.lastIndexOf("-");
  return hyphen > 0 ? cut.slice(0, hyphen) : cut;
}

export function headingNumberHtml(number: string | null): string {
  return number ? `<span class="ld-heading-number">${escapeHtml(number)} </span>` : "";
}
