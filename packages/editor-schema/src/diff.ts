import type { DocumentJson, NodeJson } from "./json.js";
import { createEditorKit, type EditorKit } from "./kit.js";
import { createDefaultRegistry } from "./modules/index.js";
import { InvalidDocumentError } from "./validate.js";

export type BlockChange = "unchanged" | "added" | "removed" | "changed" | "moved";
export type InlineChange = "unchanged" | "added" | "removed" | "formatted";

export interface InlineSegment {
  change: InlineChange;
  nodes: NodeJson[];
  before?: NodeJson[];
}

export interface AttributeChange {
  name: string;
  before: unknown;
  after: unknown;
}

export interface LineChange {
  change: "unchanged" | "added" | "removed";
  text: string;
}

export interface BlockDiff {
  change: BlockChange;
  type: string;
  before: NodeJson | null;
  after: NodeJson | null;
  attributes: AttributeChange[];
  inline?: InlineSegment[];
  lines?: LineChange[];
  children?: BlockDiff[];
}

export interface TitleDiff {
  before: string;
  after: string;
}

export interface DocumentDiff {
  title: TitleDiff | null;
  blocks: BlockDiff[];
  changes: number;
}

export interface DiffInput {
  title: string;
  document: DocumentJson;
}

export type SequenceStep =
  | { kind: "equal"; before: number; after: number }
  | { kind: "hunk"; removed: number[]; added: number[] };

const EDIT_BUDGET = 20_000_000;
const MAX_EDIT_DISTANCE = 2_000;
const MIN_EDIT_DISTANCE = 64;
const PAIRING_WINDOW = 50;
const SIMILARITY = 0.5;
const CELL_TYPES = new Set(["tableCell", "tableHeader"]);
const TOKEN = /[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}_\s]/gu;
const WORD = /^[\p{L}\p{M}\p{N}_]/u;
const WHITESPACE = /^\s+$/;

let sharedKit: EditorKit | undefined;

export function diffKit(): EditorKit {
  sharedKit ??= createEditorKit(createDefaultRegistry());
  return sharedKit;
}

function at(values: Int32Array, index: number): number {
  return values[index] ?? 0;
}

function backtrack(trace: Int32Array[], n: number, m: number): [number, number][] {
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const snapshot = trace[d] as Int32Array;
    const value = (k: number) => at(snapshot, k + d + 1);
    const k = x - y;
    const previousK = k === -d || (k !== d && value(k - 1) < value(k + 1)) ? k + 1 : k - 1;
    const previousX = value(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      pairs.push([x, y]);
    }
    x = previousX;
    y = previousY;
  }
  return pairs.reverse();
}

function myers(a: Int32Array, b: Int32Array): [number, number][] | null {
  const n = a.length;
  const m = b.length;
  const budget = Math.max(MIN_EDIT_DISTANCE, Math.floor(EDIT_BUDGET / Math.max(1, n + m)));
  const limit = Math.min(n + m, MAX_EDIT_DISTANCE, budget);
  const offset = limit + 1;
  const v = new Int32Array(2 * offset + 1);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= limit; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && at(v, offset + k - 1) < at(v, offset + k + 1))
          ? at(v, offset + k + 1)
          : at(v, offset + k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m);
    }
  }
  return null;
}

export function diffSequence(before: readonly string[], after: readonly string[]): SequenceStep[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const ids = new Map<string, number>();
  const encode = (values: readonly string[], from: number, to: number) => {
    const encoded = new Int32Array(to - from);
    for (let index = from; index < to; index += 1) {
      const key = values[index] as string;
      let id = ids.get(key);
      if (id === undefined) {
        id = ids.size;
        ids.set(key, id);
      }
      encoded[index - from] = id;
    }
    return encoded;
  };
  const middle = myers(encode(before, start, endBefore), encode(after, start, endAfter)) ?? [];
  const matches: [number, number][] = [];
  for (let index = 0; index < start; index += 1) matches.push([index, index]);
  for (const [x, y] of middle) matches.push([x + start, y + start]);
  for (let index = 0; endBefore + index < before.length; index += 1) {
    matches.push([endBefore + index, endAfter + index]);
  }
  const steps: SequenceStep[] = [];
  let i = 0;
  let j = 0;
  const gap = (toBefore: number, toAfter: number) => {
    if (i === toBefore && j === toAfter) return;
    const removed: number[] = [];
    const added: number[] = [];
    for (; i < toBefore; i += 1) removed.push(i);
    for (; j < toAfter; j += 1) added.push(j);
    steps.push({ kind: "hunk", removed, added });
  };
  for (const [x, y] of matches) {
    gap(x, y);
    steps.push({ kind: "equal", before: x, after: y });
    i = x + 1;
    j = y + 1;
  }
  gap(before.length, after.length);
  return steps;
}

interface Token {
  key: string;
  marks: string;
  node: NodeJson;
}

function tokenize(nodes: readonly NodeJson[]): Token[] {
  const tokens: Token[] = [];
  for (const node of nodes) {
    const marks = JSON.stringify(node.marks ?? []);
    if (node.type === "text") {
      for (const match of (node.text ?? "").matchAll(TOKEN)) {
        const text = match[0];
        tokens.push({
          key: `t${text}`,
          marks,
          node: { type: "text", text, ...(node.marks ? { marks: node.marks } : {}) },
        });
      }
    } else {
      tokens.push({ key: `a${JSON.stringify({ type: node.type, attrs: node.attrs ?? {} })}`, marks, node });
    }
  }
  return tokens;
}

function buildNodes(tokens: readonly Token[]): NodeJson[] {
  const nodes: NodeJson[] = [];
  let previous: Token | null = null;
  for (const token of tokens) {
    const last = nodes.at(-1);
    if (
      token.node.type === "text" &&
      last?.type === "text" &&
      previous?.node.type === "text" &&
      previous.marks === token.marks
    ) {
      last.text = `${last.text ?? ""}${token.node.text ?? ""}`;
    } else {
      nodes.push(token.node.type === "text" ? { ...token.node } : token.node);
    }
    previous = token;
  }
  return nodes;
}

interface TokenRun {
  change: InlineChange;
  before: Token[];
  after: Token[];
}

function isWhitespaceRun(run: TokenRun): boolean {
  return run.before.every((token) => token.node.type === "text" && WHITESPACE.test(token.node.text ?? ""));
}

function isEdit(run: TokenRun | undefined): boolean {
  return run?.change === "added" || run?.change === "removed";
}

function diffInline(before: readonly NodeJson[], after: readonly NodeJson[]): InlineSegment[] {
  const left = tokenize(before);
  const right = tokenize(after);
  const runs: TokenRun[] = [];
  const push = (change: InlineChange, beforeTokens: Token[], afterTokens: Token[]) => {
    const last = runs.at(-1);
    if (last?.change === change) {
      last.before.push(...beforeTokens);
      last.after.push(...afterTokens);
    } else {
      runs.push({ change, before: [...beforeTokens], after: [...afterTokens] });
    }
  };
  for (const step of diffSequence(
    left.map((token) => token.key),
    right.map((token) => token.key),
  )) {
    if (step.kind === "equal") {
      const from = left[step.before] as Token;
      const to = right[step.after] as Token;
      push(from.marks === to.marks ? "unchanged" : "formatted", [from], [to]);
      continue;
    }
    if (step.removed.length > 0)
      push(
        "removed",
        step.removed.map((index) => left[index] as Token),
        [],
      );
    if (step.added.length > 0)
      push(
        "added",
        [],
        step.added.map((index) => right[index] as Token),
      );
  }
  const bridged: TokenRun[] = [];
  runs.forEach((run, index) => {
    if (
      run.change === "unchanged" &&
      isEdit(runs[index - 1]) &&
      isEdit(runs[index + 1]) &&
      isWhitespaceRun(run)
    ) {
      bridged.push({ change: "removed", before: run.before, after: [] });
      bridged.push({ change: "added", before: [], after: run.after });
    } else {
      bridged.push(run);
    }
  });
  const segments: InlineSegment[] = [];
  let index = 0;
  while (index < bridged.length) {
    const run = bridged[index] as TokenRun;
    if (!isEdit(run)) {
      segments.push(
        run.change === "formatted"
          ? { change: "formatted", nodes: buildNodes(run.after), before: buildNodes(run.before) }
          : { change: run.change, nodes: buildNodes(run.after) },
      );
      index += 1;
      continue;
    }
    const removed: Token[] = [];
    const added: Token[] = [];
    while (index < bridged.length && isEdit(bridged[index])) {
      const edit = bridged[index] as TokenRun;
      removed.push(...edit.before);
      added.push(...edit.after);
      index += 1;
    }
    if (removed.length > 0) segments.push({ change: "removed", nodes: buildNodes(removed) });
    if (added.length > 0) segments.push({ change: "added", nodes: buildNodes(added) });
  }
  return segments;
}

function codeText(node: NodeJson): string {
  return (node.content ?? []).map((child) => child.text ?? "").join("");
}

function diffLines(before: string, after: string): LineChange[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines: LineChange[] = [];
  for (const step of diffSequence(left, right)) {
    if (step.kind === "equal") {
      lines.push({ change: "unchanged", text: left[step.before] as string });
      continue;
    }
    for (const index of step.removed) lines.push({ change: "removed", text: left[index] as string });
    for (const index of step.added) lines.push({ change: "added", text: right[index] as string });
  }
  return lines;
}

const fingerprints = new WeakMap<NodeJson, string>();

function fingerprint(node: NodeJson): string {
  let value = fingerprints.get(node);
  if (value === undefined) {
    value = JSON.stringify(node);
    fingerprints.set(node, value);
  }
  return value;
}

type NodeKind = "code" | "textblock" | "container" | "atom";

function kindOf(type: string): NodeKind {
  const spec = diffKit().registry.node(type)?.spec;
  if (spec?.code) return "code";
  const content = spec?.content;
  if (content === undefined) return "atom";
  return /\b(inline|text)\b/.test(content) ? "textblock" : "container";
}

interface Features {
  words: Map<string, number>;
  wordCount: number;
  children: Map<string, number>;
  childCount: number;
}

const featureCache = new WeakMap<NodeJson, Features>();

function collectWords(node: NodeJson, into: string[]): void {
  if (node.type === "text") {
    for (const match of (node.text ?? "").matchAll(TOKEN)) {
      if (WORD.test(match[0])) into.push(match[0]);
    }
    return;
  }
  if (!node.content) {
    into.push(`a${JSON.stringify({ type: node.type, attrs: node.attrs ?? {} })}`);
    return;
  }
  for (const child of node.content) collectWords(child, into);
}

function counted(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function featuresOf(node: NodeJson): Features {
  let features = featureCache.get(node);
  if (!features) {
    const words: string[] = [];
    if (kindOf(node.type) === "code") words.push(...codeText(node).split("\n"));
    else for (const child of node.content ?? []) collectWords(child, words);
    const children = (node.content ?? []).map(fingerprint);
    features = {
      words: counted(words),
      wordCount: words.length,
      children: counted(children),
      childCount: children.length,
    };
    featureCache.set(node, features);
  }
  return features;
}

function dice(left: Map<string, number>, leftCount: number, right: Map<string, number>, rightCount: number) {
  if (leftCount + rightCount === 0) return 1;
  let common = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const [value, count] of small) common += Math.min(count, large.get(value) ?? 0);
  return (2 * common) / (leftCount + rightCount);
}

function compatible(before: NodeJson, after: NodeJson): boolean {
  return before.type === after.type || (CELL_TYPES.has(before.type) && CELL_TYPES.has(after.type));
}

function similar(before: NodeJson, after: NodeJson): boolean {
  if (!compatible(before, after)) return false;
  const kind = kindOf(after.type);
  if (kind === "atom") return true;
  const left = featuresOf(before);
  const right = featuresOf(after);
  const words = dice(left.words, left.wordCount, right.words, right.wordCount);
  if (words >= SIMILARITY) return true;
  if (kind !== "container") return false;
  return dice(left.children, left.childCount, right.children, right.childCount) >= SIMILARITY;
}

interface Level {
  positional: boolean;
  moves: boolean;
}

const BLOCK_LEVEL: Level = { positional: false, moves: true };
const ROW_LEVEL: Level = { positional: true, moves: true };
const CELL_LEVEL: Level = { positional: true, moves: false };

function levelOf(type: string): Level {
  if (type === "table") return ROW_LEVEL;
  if (type === "tableRow") return CELL_LEVEL;
  return BLOCK_LEVEL;
}

function entry(change: BlockChange, before: NodeJson | null, after: NodeJson | null): BlockDiff {
  return { change, type: (after ?? before)?.type ?? "", before, after, attributes: [] };
}

function attributeChanges(before: NodeJson, after: NodeJson): AttributeChange[] {
  const changes: AttributeChange[] = [];
  if (before.type !== after.type) changes.push({ name: "type", before: before.type, after: after.type });
  const left = before.attrs ?? {};
  const right = after.attrs ?? {};
  const names = [...Object.keys(left), ...Object.keys(right).filter((name) => !Object.hasOwn(left, name))];
  for (const name of names) {
    if (JSON.stringify(left[name]) !== JSON.stringify(right[name])) {
      changes.push({ name, before: left[name] ?? null, after: right[name] ?? null });
    }
  }
  return changes;
}

function countSegments(segments: readonly InlineSegment[]): number {
  let count = 0;
  segments.forEach((segment, index) => {
    if (segment.change === "unchanged") return;
    if (segment.change === "added" && segments[index - 1]?.change === "removed") return;
    count += 1;
  });
  return count;
}

function countLines(lines: readonly LineChange[]): number {
  let count = 0;
  lines.forEach((line, index) => {
    if (line.change !== "unchanged" && (index === 0 || lines[index - 1]?.change === "unchanged")) count += 1;
  });
  return count;
}

function countChanges(diff: BlockDiff): number {
  switch (diff.change) {
    case "unchanged":
      return 0;
    case "changed":
      return (
        diff.attributes.length +
        countSegments(diff.inline ?? []) +
        countLines(diff.lines ?? []) +
        (diff.children ?? []).reduce((sum, child) => sum + countChanges(child), 0)
      );
    default:
      return 1;
  }
}

function diffBlock(before: NodeJson, after: NodeJson): BlockDiff {
  const diff: BlockDiff = { ...entry("changed", before, after), attributes: attributeChanges(before, after) };
  const kind = kindOf(after.type);
  if (kind === "code") {
    const left = codeText(before);
    const right = codeText(after);
    if (left !== right) diff.lines = diffLines(left, right);
  } else if (kind === "textblock") {
    if (JSON.stringify(before.content ?? []) !== JSON.stringify(after.content ?? [])) {
      const inline = diffInline(before.content ?? [], after.content ?? []);
      if (inline.some((segment) => segment.change !== "unchanged")) diff.inline = inline;
    }
  } else if (kind === "container") {
    diff.children = diffChildren(before.content ?? [], after.content ?? [], levelOf(after.type));
  }
  return countChanges(diff) === 0 ? entry("unchanged", before, after) : diff;
}

function pairUp(
  removed: readonly number[],
  candidates: readonly number[],
  before: readonly NodeJson[],
  after: readonly NodeJson[],
  level: Level,
): [number, number][] {
  if (level.positional && removed.length === candidates.length) {
    return removed.map((index, position) => [index, candidates[position] as number]);
  }
  const pairs: [number, number][] = [];
  let start = 0;
  for (const index of removed) {
    const end = Math.min(candidates.length, start + PAIRING_WINDOW);
    for (let position = start; position < end; position += 1) {
      const candidate = candidates[position] as number;
      if (similar(before[index] as NodeJson, after[candidate] as NodeJson)) {
        pairs.push([index, candidate]);
        start = position + 1;
        break;
      }
    }
  }
  return pairs;
}

function diffChildren(before: readonly NodeJson[], after: readonly NodeJson[], level: Level): BlockDiff[] {
  const beforeKeys = before.map(fingerprint);
  const afterKeys = after.map(fingerprint);
  const steps = diffSequence(beforeKeys, afterKeys);
  const movedFrom = new Map<number, number>();
  const movedAway = new Set<number>();
  if (level.moves) {
    const removedByKey = new Map<string, number[]>();
    for (const step of steps) {
      if (step.kind !== "hunk") continue;
      for (const index of step.removed) {
        const key = beforeKeys[index] as string;
        const queue = removedByKey.get(key);
        if (queue) queue.push(index);
        else removedByKey.set(key, [index]);
      }
    }
    for (const step of steps) {
      if (step.kind !== "hunk") continue;
      for (const index of step.added) {
        const source = removedByKey.get(afterKeys[index] as string)?.shift();
        if (source === undefined) continue;
        movedFrom.set(index, source);
        movedAway.add(source);
      }
    }
  }
  const result: BlockDiff[] = [];
  const addedEntry = (index: number) => {
    const source = movedFrom.get(index);
    return source === undefined
      ? entry("added", null, after[index] as NodeJson)
      : entry("moved", before[source] as NodeJson, after[index] as NodeJson);
  };
  for (const step of steps) {
    if (step.kind === "equal") {
      result.push(entry("unchanged", before[step.before] as NodeJson, after[step.after] as NodeJson));
      continue;
    }
    const removed = step.removed.filter((index) => !movedAway.has(index));
    const candidates = step.added.filter((index) => !movedFrom.has(index));
    const pairs = pairUp(removed, candidates, before, after, level);
    let removedAt = 0;
    let addedAt = 0;
    for (const [from, to] of pairs) {
      while (removed[removedAt] !== from) {
        result.push(entry("removed", before[removed[removedAt] as number] as NodeJson, null));
        removedAt += 1;
      }
      while (step.added[addedAt] !== to) {
        result.push(addedEntry(step.added[addedAt] as number));
        addedAt += 1;
      }
      removedAt += 1;
      addedAt += 1;
      result.push(diffBlock(before[from] as NodeJson, after[to] as NodeJson));
    }
    for (; removedAt < removed.length; removedAt += 1) {
      result.push(entry("removed", before[removed[removedAt] as number] as NodeJson, null));
    }
    for (; addedAt < step.added.length; addedAt += 1) result.push(addedEntry(step.added[addedAt] as number));
  }
  return result;
}

function normalized(document: DocumentJson): DocumentJson {
  const result = diffKit().validate(document);
  if (!result.ok) throw new InvalidDocumentError(result.problems);
  return result.document;
}

export function diffDocuments(before: DiffInput, after: DiffInput): DocumentDiff {
  const blocks = diffChildren(
    normalized(before.document).content ?? [],
    normalized(after.document).content ?? [],
    BLOCK_LEVEL,
  );
  const title = before.title === after.title ? null : { before: before.title, after: after.title };
  const changes = blocks.reduce((sum, block) => sum + countChanges(block), title ? 1 : 0);
  return { title, blocks, changes };
}
