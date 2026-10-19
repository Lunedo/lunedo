export class Html {
  constructor(readonly value: string) {}

  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

export function raw(value: string): Html {
  return new Html(value);
}

function part(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(part).join("");
  if (value === null || value === undefined || value === false) return "";
  return escape(String(value));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let result = strings[0] ?? "";
  for (let index = 0; index < values.length; index += 1) {
    result += part(values[index]) + (strings[index + 1] ?? "");
  }
  return new Html(result);
}

export function when(condition: unknown, content: () => Html): Html | null {
  return condition ? content() : null;
}
