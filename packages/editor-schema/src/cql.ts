export interface CqlCondition {
  field: string;
  values: string[];
}

type Token =
  | { kind: "word"; value: string }
  | { kind: "string"; value: string }
  | { kind: "symbol"; value: "(" | ")" | "," | "=" };

type Expression =
  | { kind: "clause"; field: string; values: string[] }
  | { kind: "and" | "or"; items: Expression[] };

const MAX_CQL_LENGTH = 2000;
const MAX_CQL_TOKENS = 200;

function tokenize(cql: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < cql.length) {
    const character = cql[index] as string;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "(" || character === ")" || character === "," || character === "=") {
      tokens.push({ kind: "symbol", value: character });
      index += 1;
    } else if (character === '"' || character === "'") {
      let value = "";
      index += 1;
      while (index < cql.length && cql[index] !== character) {
        if (cql[index] === "\\" && index + 1 < cql.length) index += 1;
        value += cql[index];
        index += 1;
      }
      if (index >= cql.length) return null;
      index += 1;
      tokens.push({ kind: "string", value });
    } else {
      const match = /^[^\s"'()=,!~<>]+/.exec(cql.slice(index));
      if (!match) return null;
      tokens.push({ kind: "word", value: match[0] });
      index += match[0].length;
    }
    if (tokens.length > MAX_CQL_TOKENS) return null;
  }
  return tokens;
}

class Parser {
  index = 0;

  constructor(private readonly tokens: Token[]) {}

  peek(): Token | undefined {
    return this.tokens[this.index];
  }

  keyword(name: string): boolean {
    const token = this.peek();
    if (token?.kind === "word" && token.value.toLowerCase() === name) {
      this.index += 1;
      return true;
    }
    return false;
  }

  symbol(value: string): boolean {
    const token = this.peek();
    if (token?.kind === "symbol" && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  expression(): Expression | null {
    const items: Expression[] = [];
    do {
      const term = this.term();
      if (!term) return null;
      items.push(term);
    } while (this.keyword("or"));
    return items.length === 1 ? (items[0] as Expression) : { kind: "or", items };
  }

  term(): Expression | null {
    const items: Expression[] = [];
    do {
      const factor = this.factor();
      if (!factor) return null;
      items.push(factor);
    } while (this.keyword("and"));
    return items.length === 1 ? (items[0] as Expression) : { kind: "and", items };
  }

  factor(): Expression | null {
    if (this.symbol("(")) {
      const inner = this.expression();
      return inner && this.symbol(")") ? inner : null;
    }
    const field = this.peek();
    if (field?.kind !== "word" || ["and", "or", "in", "not"].includes(field.value.toLowerCase())) return null;
    this.index += 1;
    if (this.symbol("=")) {
      const value = this.value();
      return value === null ? null : { kind: "clause", field: field.value.toLowerCase(), values: [value] };
    }
    if (!this.keyword("in") || !this.symbol("(")) return null;
    const values: string[] = [];
    do {
      const value = this.value();
      if (value === null) return null;
      values.push(value);
    } while (this.symbol(","));
    return this.symbol(")") ? { kind: "clause", field: field.value.toLowerCase(), values } : null;
  }

  value(): string | null {
    const token = this.peek();
    if (!token || token.kind === "symbol") return null;
    this.index += 1;
    if (token.kind === "string") return token.value;
    if (this.symbol("(")) return this.symbol(")") ? `${token.value.toLowerCase()}()` : null;
    return token.value;
  }
}

function disjunction(expression: Expression): CqlCondition | null {
  if (expression.kind === "clause") return { field: expression.field, values: [...expression.values] };
  if (expression.kind === "and") return null;
  const groups = expression.items.map(disjunction);
  if (groups.some((group) => group === null)) return null;
  const valid = groups as CqlCondition[];
  const field = valid[0]?.field;
  if (!field || valid.some((group) => group.field !== field)) return null;
  return { field, values: [...new Set(valid.flatMap((group) => group.values))] };
}

function conjunction(expression: Expression): CqlCondition[] | null {
  if (expression.kind === "and") {
    const parts = expression.items.map(conjunction);
    return parts.some((part) => part === null) ? null : (parts as CqlCondition[][]).flat();
  }
  const group = disjunction(expression);
  return group ? [group] : null;
}

export function parseCql(cql: string): CqlCondition[] | null {
  if (cql.trim().length === 0 || cql.length > MAX_CQL_LENGTH) return null;
  const tokens = tokenize(cql);
  if (!tokens || tokens.length === 0) return null;
  const parser = new Parser(tokens);
  const expression = parser.expression();
  if (!expression || parser.peek() !== undefined) return null;
  return conjunction(expression);
}
