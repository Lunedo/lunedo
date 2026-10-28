import { code } from "./docs-reference.ts";

export interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly default?: unknown;
  readonly minimum?: number;
  readonly exclusiveMinimum?: number;
  readonly maximum?: number;
  readonly exclusiveMaximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly format?: string;
  readonly items?: JsonSchema;
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
}

const FORMATS: Readonly<Record<string, string>> = {
  uuid: "an ID",
  email: "an e-mail address",
  uri: "an address",
  url: "an address",
};

export function list(values: readonly string[], conjunction = "or"): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} ${conjunction} ${values.at(-1)}`;
}

function number(value: number): string {
  return value.toLocaleString("en-US");
}

function integerRange(schema: JsonSchema, noun: string): string {
  const minimum =
    schema.minimum ?? (schema.exclusiveMinimum === undefined ? null : schema.exclusiveMinimum + 1);
  const upper =
    schema.maximum ?? (schema.exclusiveMaximum === undefined ? null : schema.exclusiveMaximum - 1);
  const maximum = upper !== null && upper < Number.MAX_SAFE_INTEGER ? upper : null;
  if (minimum !== null && maximum !== null) return `${noun} from ${number(minimum)} to ${number(maximum)}`;
  if (minimum !== null) return `${noun} of at least ${number(minimum)}`;
  if (maximum !== null) return `${noun} of at most ${number(maximum)}`;
  return noun;
}

function text(schema: JsonSchema): string {
  if (schema.format && FORMATS[schema.format]) return FORMATS[schema.format] ?? "";
  const { minLength, maxLength } = schema;
  if (minLength !== undefined && minLength > 1 && maxLength !== undefined) {
    return `text of ${minLength} to ${maxLength} characters`;
  }
  if (minLength !== undefined && minLength > 1) return `text of at least ${minLength} characters`;
  if (maxLength !== undefined) return `text of at most ${maxLength} characters`;
  return "";
}

function phrase(schema: JsonSchema): string {
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives) {
    const parts = alternatives.map(phrase);
    return parts.includes("") ? "" : list([...new Set(parts)]);
  }
  if (schema.const !== undefined) return schema.const === "" ? "empty" : code(String(schema.const));
  if (schema.enum) return list(schema.enum.map((value) => code(String(value))));
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "null") return "none";
  if (type === "boolean") return list([code("true"), code("false")]);
  if (type === "integer") return integerRange(schema, "a whole number");
  if (type === "number") return integerRange(schema, "a number");
  if (type === "string") return text(schema);
  if (type === "array") {
    const items = schema.items ? phrase(schema.items) : "";
    const size = schema.maxItems === undefined ? "a list" : `a list of up to ${schema.maxItems} entries`;
    return items === "" ? size : `${size}, each ${items}`;
  }
  if (type === "object") return "a structured value";
  return "";
}

export function allowedValues(schema: JsonSchema): string {
  const value = phrase(schema);
  return value === "" ? "" : `${value.charAt(0).toUpperCase()}${value.slice(1)}.`;
}
