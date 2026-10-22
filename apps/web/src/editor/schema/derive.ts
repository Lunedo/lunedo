import { modules } from "@lunedo/editor-schema";
import type { Attribute } from "@tiptap/core";

const NODE_FIELDS = [
  "content",
  "group",
  "inline",
  "atom",
  "marks",
  "defining",
  "isolating",
  "code",
  "selectable",
  "draggable",
  "whitespace",
  "tableRole",
] as const;

const MARK_FIELDS = ["inclusive", "excludes", "spanning", "code", "group"] as const;

const BOOLEAN_DEFAULTS: Record<string, boolean> = {
  inline: false,
  atom: false,
  defining: false,
  isolating: false,
  code: false,
  draggable: false,
};

export function nodeFields(name: string): Record<string, unknown> {
  const definition = modules.node(name);
  if (!definition) throw new Error(`The editor schema has no node ${name}`);
  const spec = definition.spec as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const field of NODE_FIELDS) {
    if (field in spec) fields[field] = spec[field];
    else if (field in BOOLEAN_DEFAULTS) fields[field] = BOOLEAN_DEFAULTS[field];
    else if (field === "selectable") fields[field] = true;
  }
  return fields;
}

export function markFields(name: string): Record<string, unknown> {
  const definition = modules.mark(name);
  if (!definition) throw new Error(`The editor schema has no mark ${name}`);
  const spec = definition.spec as Record<string, unknown>;
  const fields: Record<string, unknown> = {
    inclusive: spec.inclusive ?? true,
    spanning: spec.spanning ?? true,
    code: spec.code ?? false,
    excludes: spec.excludes ?? name,
  };
  for (const field of MARK_FIELDS) if (field in spec) fields[field] = spec[field];
  return fields;
}

export interface AttributeCodec {
  parse?: (element: HTMLElement) => unknown;
  render?: (value: unknown) => Record<string, string> | null;
}

function dataName(attribute: string): string {
  return `data-${attribute.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

export function dataAttribute(attribute: string, kind: "string" | "number" | "json" | "boolean" = "string") {
  const name = dataName(attribute);
  return {
    parse: (element: HTMLElement) => {
      const raw = element.getAttribute(name);
      if (raw === null) return undefined;
      if (kind === "number") {
        const value = Number(raw);
        return Number.isFinite(value) ? value : undefined;
      }
      if (kind === "boolean") return raw === "true";
      if (kind === "json") {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return undefined;
        }
      }
      return raw;
    },
    render: (value: unknown) =>
      value === null || value === undefined
        ? null
        : { [name]: typeof value === "string" ? value : JSON.stringify(value) },
  } satisfies AttributeCodec;
}

export function schemaAttributes(
  kind: "node" | "mark",
  name: string,
  codecs: Record<string, AttributeCodec> = {},
): Record<string, Attribute> {
  const definition = kind === "node" ? modules.node(name) : modules.mark(name);
  if (!definition) throw new Error(`The editor schema has no ${kind} ${name}`);
  const attributes: Record<string, Attribute> = {};
  for (const [attribute, spec] of Object.entries(definition.attrs ?? {})) {
    const codec =
      codecs[attribute] ?? dataAttribute(attribute, typeof spec.default === "number" ? "number" : "string");
    const validator = spec.schema;
    attributes[attribute] = {
      ...(Object.hasOwn(spec, "default") ? { default: spec.default } : { isRequired: true, default: null }),
      parseHTML: (element: HTMLElement) => {
        const value = codec.parse ? codec.parse(element) : undefined;
        if (value === undefined) return undefined;
        return validator.safeParse(value).success ? value : undefined;
      },
      renderHTML: (attrs: Record<string, unknown>) => codec.render?.(attrs[attribute]) ?? {},
    };
  }
  return attributes;
}

export function attributeIsValid(
  kind: "node" | "mark",
  name: string,
  attribute: string,
  value: unknown,
): boolean {
  const definition = kind === "node" ? modules.node(name) : modules.mark(name);
  const spec = definition?.attrs?.[attribute];
  if (!spec) return false;
  return spec.schema.safeParse(value).success;
}

export function requiredAttributesPresent(
  kind: "node" | "mark",
  name: string,
  codecs: Record<string, AttributeCodec> = {},
): (element: HTMLElement) => null | false {
  const definition = kind === "node" ? modules.node(name) : modules.mark(name);
  const required = Object.entries(definition?.attrs ?? {}).filter(
    ([, spec]) => !Object.hasOwn(spec, "default"),
  );
  return (element) => {
    for (const [attribute, spec] of required) {
      const codec = codecs[attribute] ?? dataAttribute(attribute);
      const value = codec.parse?.(element);
      if (value === undefined || !spec.schema.safeParse(value).success) return false;
    }
    return null;
  };
}
