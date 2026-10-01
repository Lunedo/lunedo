import ts from "typescript";

export interface Finding {
  line: number;
  text: string;
}

const USER_FACING_PROPS = new Set([
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "alt",
  "cancelLabel",
  "confirmLabel",
  "description",
  "emptyText",
  "heading",
  "hint",
  "label",
  "placeholder",
  "title",
]);

const LETTER = /\p{L}/u;

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function literalText(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return literalText(node.expression);
  if (ts.isParenthesizedExpression(node)) return literalText(node.expression);
  return null;
}

export function findUntranslatedText(fileName: string, content: string): Finding[] {
  const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, " ").trim();
      if (text && LETTER.test(text)) findings.push({ line: lineOf(source, node), text });
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      const text = literalText(node.initializer as ts.Expression | undefined);
      if (USER_FACING_PROPS.has(name) && text !== null && LETTER.test(text)) {
        findings.push({ line: lineOf(source, node), text: `${name}="${text}"` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

type Messages = { [key: string]: string | Messages };

function flatten(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );
}

export function compareKeys(languages: Record<string, Messages>): { language: string; missing: string[] }[] {
  const keysByLanguage = Object.fromEntries(
    Object.entries(languages).map(([language, messages]) => [language, new Set(flatten(messages))]),
  );
  const all = new Set(Object.values(keysByLanguage).flatMap((keys) => [...keys]));
  return Object.entries(keysByLanguage)
    .map(([language, keys]) => ({ language, missing: [...all].filter((key) => !keys.has(key)).sort() }))
    .filter((entry) => entry.missing.length > 0);
}

export function findEmptyMessages(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string"
      ? value.trim() === ""
        ? [`${prefix}${key}`]
        : []
      : findEmptyMessages(value, `${prefix}${key}.`),
  );
}
