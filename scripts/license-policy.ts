/**
 * OSI-approved licenses accepted for dependencies. Extend the list only
 * with SPDX identifiers from https://opensource.org/licenses.
 */
export const approvedLicenses = new Set([
  "0BSD",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "EPL-2.0",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "OFL-1.1",
  "Python-2.0",
  "Unlicense",
  "UPL-1.0",
  "Zlib",
]);

type Expression = { license: string } | { operator: "AND" | "OR"; left: Expression; right: Expression };

function tokenize(expression: string): string[] {
  return expression.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/).filter(Boolean);
}

function parse(tokens: string[]): Expression {
  let position = 0;

  const primary = (): Expression => {
    const token = tokens[position++];
    if (token === undefined || token === ")" || token === "AND" || token === "OR") {
      throw new Error("Unexpected token in license expression");
    }
    if (token === "(") {
      const inner = or();
      if (tokens[position++] !== ")") throw new Error("Missing closing parenthesis");
      return inner;
    }
    if (tokens[position] === "WITH") position += 2;
    return { license: token };
  };

  const and = (): Expression => {
    let left = primary();
    while (tokens[position] === "AND") {
      position++;
      left = { operator: "AND", left, right: primary() };
    }
    return left;
  };

  const or = (): Expression => {
    let left = and();
    while (tokens[position] === "OR") {
      position++;
      left = { operator: "OR", left, right: and() };
    }
    return left;
  };

  const result = or();
  if (position !== tokens.length) throw new Error("Unexpected trailing tokens in license expression");
  return result;
}

function evaluate(expression: Expression): boolean {
  if ("license" in expression) return approvedLicenses.has(expression.license.replace(/\+$/, ""));
  return expression.operator === "AND"
    ? evaluate(expression.left) && evaluate(expression.right)
    : evaluate(expression.left) || evaluate(expression.right);
}

/** Checks an SPDX license expression such as `MIT OR Apache-2.0`. */
export function isApprovedLicense(expression: string): boolean {
  try {
    return evaluate(parse(tokenize(expression)));
  } catch {
    return false;
  }
}
