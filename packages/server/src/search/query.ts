export const searchOperators = ["space", "label", "author", "status", "type"] as const;
export type SearchOperator = (typeof searchOperators)[number];

export const MAX_QUERY_LENGTH = 500;
export const MAX_QUERY_ATOMS = 20;

export interface QueryAtom {
  kind: "term" | "phrase";
  text: string;
}

export interface ParsedQuery {
  clauses: QueryAtom[][];
  excluded: QueryAtom[];
  operators: Record<SearchOperator, string[]>;
}

function isOperator(name: string): name is SearchOperator {
  return (searchOperators as readonly string[]).includes(name);
}

export function parseQuery(input: string): ParsedQuery {
  const text = input.slice(0, MAX_QUERY_LENGTH);
  const parsed: ParsedQuery = {
    clauses: [],
    excluded: [],
    operators: { space: [], label: [], author: [], status: [], type: [] },
  };
  let index = 0;
  let joinNext = false;
  let atoms = 0;

  const readQuoted = (): string => {
    const end = text.indexOf('"', index + 1);
    const value = text.slice(index + 1, end === -1 ? text.length : end);
    index = end === -1 ? text.length : end + 1;
    return value.trim();
  };
  const readWord = (): string => {
    const start = index;
    while (index < text.length && !/\s/.test(text.charAt(index))) index += 1;
    return text.slice(start, index);
  };

  while (index < text.length) {
    if (/\s/.test(text.charAt(index))) {
      index += 1;
      continue;
    }
    const negated =
      text.charAt(index) === "-" && index + 1 < text.length && !/\s/.test(text.charAt(index + 1));
    if (negated) index += 1;
    let atom: QueryAtom | null = null;
    if (text.charAt(index) === '"') {
      const phrase = readQuoted();
      if (phrase.length > 0) atom = { kind: "phrase", text: phrase };
    } else {
      const start = index;
      const word = readWord();
      const operator = /^([a-zA-Z]+):(.*)$/.exec(word);
      const name = operator?.[1]?.toLowerCase() ?? "";
      if (operator && !negated && isOperator(name)) {
        let value = operator[2] ?? "";
        if (value.startsWith('"')) {
          index = start + name.length + 1;
          value = readQuoted();
        }
        if (value.length > 0 && parsed.operators[name].length < MAX_QUERY_ATOMS) {
          parsed.operators[name].push(value);
        }
        joinNext = false;
        continue;
      }
      if (word === "OR" && !negated) {
        joinNext = parsed.clauses.length > 0;
        continue;
      }
      if (word.length > 0) atom = { kind: "term", text: word };
    }
    if (!atom || atoms >= MAX_QUERY_ATOMS) {
      joinNext = false;
      continue;
    }
    atoms += 1;
    if (negated) {
      parsed.excluded.push(atom);
      joinNext = false;
      continue;
    }
    const last = parsed.clauses[parsed.clauses.length - 1];
    if (joinNext && last) last.push(atom);
    else parsed.clauses.push([atom]);
    joinNext = false;
  }
  return parsed;
}

export function lastTerm(query: ParsedQuery): QueryAtom | null {
  const clause = query.clauses[query.clauses.length - 1];
  const atom = clause?.[clause.length - 1];
  return atom?.kind === "term" ? atom : null;
}
