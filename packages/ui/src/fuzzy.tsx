import { Fragment } from "react";

export type MatchRange = readonly [start: number, end: number];

export interface FuzzyMatch {
  score: number;
  ranges: MatchRange[];
}

function folded(text: string): { value: string; index: number[] } {
  let value = "";
  const index: number[] = [];
  Array.from(text).forEach((character, position) => {
    const start = text.indexOf(character, position);
    const plain = character
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    for (const part of plain) {
      value += part;
      index.push(start);
    }
  });
  return { value, index };
}

function isWordStart(text: string, position: number): boolean {
  if (position === 0) return true;
  return !/[\p{L}\p{N}]/u.test(text.charAt(position - 1));
}

function merge(positions: readonly number[]): MatchRange[] {
  const ranges: [number, number][] = [];
  for (const position of positions) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === position) last[1] = position + 1;
    else ranges.push([position, position + 1]);
  }
  return ranges;
}

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = folded(query.trim()).value.replace(/\s+/g, " ");
  if (needle.length === 0) return { score: 0, ranges: [] };
  const haystack = folded(text);
  const exact = haystack.value.indexOf(needle);
  if (exact !== -1) {
    const positions = Array.from({ length: needle.length }, (_, offset) => exact + offset).filter(
      (position) => haystack.value.charAt(position) !== " ",
    );
    const start = isWordStart(haystack.value, exact) ? 200 : 100;
    return {
      score: 1000 + start - exact - (haystack.value.length - needle.length) / 100,
      ranges: merge(positions.map((position) => haystack.index[position] ?? position)),
    };
  }
  const letters = needle.replace(/ /g, "");
  return subsequence(letters, haystack, true) ?? subsequence(letters, haystack, false);
}

function subsequence(
  letters: string,
  haystack: { value: string; index: number[] },
  preferWordStarts: boolean,
): FuzzyMatch | null {
  const positions: number[] = [];
  let from = 0;
  let score = 0;
  for (const letter of letters) {
    const previous = positions[positions.length - 1];
    let found = -1;
    for (let position = from; position < haystack.value.length; position += 1) {
      if (haystack.value.charAt(position) !== letter) continue;
      if (found === -1) found = position;
      if (!preferWordStarts) break;
      if (position === (previous ?? -2) + 1 || isWordStart(haystack.value, position)) {
        found = position;
        break;
      }
    }
    if (found === -1) return null;
    if (previous !== undefined && found === previous + 1) score += 8;
    if (isWordStart(haystack.value, found)) score += 10;
    positions.push(found);
    from = found + 1;
  }
  const first = positions[0] ?? 0;
  const span = (positions[positions.length - 1] ?? 0) - first;
  return {
    score: score - span - first / 10,
    ranges: merge(positions.map((position) => haystack.index[position] ?? position)),
  };
}

export interface HighlightPart {
  text: string;
  highlighted: boolean;
}

export function highlightParts(text: string, ranges: readonly MatchRange[]): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), highlighted: false });
    parts.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts.filter((part) => part.text.length > 0);
}

export function Highlighted({ parts }: { parts: readonly HighlightPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.highlighted ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity other than their order
          <mark key={index} className="rounded-sm bg-warning-soft font-semibold text-inherit">
            {part.text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity other than their order
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  );
}
