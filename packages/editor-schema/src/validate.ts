import { type Node as ProseMirrorNode, type Schema } from "prosemirror-model";
import type { DocumentJson, MarkJson, NodeJson, ValidNode } from "./json.js";
import { toValidNode } from "./json.js";
import { type AttributeSpec, hasDefault, type ModuleRegistry } from "./module.js";

export const MAX_DEPTH = 40;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_NODES = 50_000;
export const MAX_PROBLEMS = 50;

export const limits = {
  maxDepth: MAX_DEPTH,
  maxDocumentBytes: MAX_DOCUMENT_BYTES,
  maxNodes: MAX_NODES,
} as const;

export type ValidationCode =
  | "notAnObject"
  | "notSerializable"
  | "tooLarge"
  | "tooDeep"
  | "tooManyNodes"
  | "unknownField"
  | "unknownNode"
  | "unknownMark"
  | "unknownAttribute"
  | "missingAttribute"
  | "invalidAttribute"
  | "invalidText"
  | "emptyText"
  | "invalidNode"
  | "invalidContent"
  | "markNotAllowed"
  | "conflictingMarks";

export interface ValidationProblem {
  path: string;
  code: ValidationCode;
  message: string;
}

export type ValidationResult =
  | { ok: true; document: DocumentJson }
  | { ok: false; problems: ValidationProblem[] };

export class InvalidDocumentError extends Error {
  override name = "InvalidDocumentError";

  constructor(readonly problems: ValidationProblem[]) {
    super(`Invalid document: ${problems.map((problem) => `${problem.path}: ${problem.message}`).join("; ")}`);
  }
}

const NODE_FIELDS = new Set(["type", "attrs", "content", "marks", "text"]);
const MARK_FIELDS = new Set(["type", "attrs"]);
const encoder = new TextEncoder();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

class LimitExceeded extends Error {}

class Walker {
  readonly problems: ValidationProblem[] = [];
  readonly rules: { path: string; node: NodeJson; rule: (node: ValidNode) => string | null }[] = [];
  nodes = 0;

  constructor(readonly registry: ModuleRegistry) {}

  problem(path: string, code: ValidationCode, message: string): void {
    if (this.problems.length < MAX_PROBLEMS) this.problems.push({ path, code, message });
  }

  attributes(
    path: string,
    owner: string,
    raw: unknown,
    specs: Record<string, AttributeSpec> | undefined,
  ): Record<string, unknown> | undefined {
    const definitions = specs ?? {};
    if (raw !== undefined && !isPlainObject(raw)) {
      this.problem(`${path}.attrs`, "invalidAttribute", `The attributes of ${owner} must be an object`);
      return undefined;
    }
    const values = raw ?? {};
    for (const key of Object.keys(values)) {
      if (!Object.hasOwn(definitions, key)) {
        this.problem(`${path}.attrs.${key}`, "unknownAttribute", `${owner} has no attribute ${key}`);
      }
    }
    const normalized: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(definitions)) {
      const value = values[key];
      if (value === undefined) {
        if (hasDefault(spec)) normalized[key] = structuredClone(spec.default);
        else this.problem(`${path}.attrs.${key}`, "missingAttribute", `${owner} needs the attribute ${key}`);
        continue;
      }
      const parsed = spec.schema.safeParse(value);
      if (!parsed.success) {
        const reason = parsed.error.issues[0]?.message ?? "Invalid value";
        this.problem(`${path}.attrs.${key}`, "invalidAttribute", `${owner}.${key}: ${reason}`);
        continue;
      }
      normalized[key] = parsed.data;
    }
    return Object.keys(definitions).length > 0 ? normalized : undefined;
  }

  mark(path: string, raw: unknown): MarkJson | undefined {
    if (!isPlainObject(raw)) {
      this.problem(path, "notAnObject", "A mark must be an object");
      return undefined;
    }
    for (const key of Object.keys(raw)) {
      if (!MARK_FIELDS.has(key)) this.problem(`${path}.${key}`, "unknownField", `Marks have no field ${key}`);
    }
    const type = raw.type;
    const definition = typeof type === "string" ? this.registry.mark(type) : undefined;
    if (!definition || typeof type !== "string") {
      this.problem(`${path}.type`, "unknownMark", `Unknown mark ${String(type)}`);
      return undefined;
    }
    const attrs = this.attributes(path, type, raw.attrs, definition.attrs);
    return attrs ? { type, attrs } : { type };
  }

  node(path: string, raw: unknown, depth: number): NodeJson | undefined {
    if (depth > MAX_DEPTH) {
      this.problem(path, "tooDeep", `Content is nested deeper than ${MAX_DEPTH} levels`);
      throw new LimitExceeded();
    }
    this.nodes += 1;
    if (this.nodes > MAX_NODES) {
      this.problem(path, "tooManyNodes", `A document has at most ${MAX_NODES} nodes`);
      throw new LimitExceeded();
    }
    if (!isPlainObject(raw)) {
      this.problem(path, "notAnObject", "A node must be an object");
      return undefined;
    }
    for (const key of Object.keys(raw)) {
      if (!NODE_FIELDS.has(key)) this.problem(`${path}.${key}`, "unknownField", `Nodes have no field ${key}`);
    }
    const type = raw.type;
    const definition = typeof type === "string" ? this.registry.node(type) : undefined;
    if (!definition || typeof type !== "string") {
      this.problem(`${path}.type`, "unknownNode", `Unknown node ${String(type)}`);
      return undefined;
    }
    const result: NodeJson = { type };
    if (type === "text") {
      if (typeof raw.text !== "string") {
        this.problem(`${path}.text`, "invalidText", "A text node needs a text");
      } else if (raw.text.length === 0) {
        this.problem(`${path}.text`, "emptyText", "Text nodes must not be empty");
      } else {
        result.text = raw.text;
      }
      if (raw.content !== undefined) this.problem(`${path}.content`, "unknownField", "Text has no content");
      if (raw.attrs !== undefined && !(isPlainObject(raw.attrs) && Object.keys(raw.attrs).length === 0)) {
        this.problem(`${path}.attrs`, "unknownAttribute", "Text has no attributes");
      }
    } else {
      if (raw.text !== undefined) this.problem(`${path}.text`, "unknownField", `${type} has no text`);
      const attrs = this.attributes(path, type, raw.attrs, definition.attrs);
      if (attrs) result.attrs = attrs;
      if (raw.content !== undefined) {
        if (!Array.isArray(raw.content)) {
          this.problem(`${path}.content`, "invalidContent", "Content must be a list");
        } else {
          const content: NodeJson[] = [];
          raw.content.forEach((child, index) => {
            const normalized = this.node(`${path}.content[${index}]`, child, depth + 1);
            if (normalized) content.push(normalized);
          });
          result.content = content;
        }
      }
    }
    if (raw.marks !== undefined) {
      if (!Array.isArray(raw.marks)) {
        this.problem(`${path}.marks`, "invalidContent", "Marks must be a list");
      } else {
        const marks: MarkJson[] = [];
        raw.marks.forEach((mark, index) => {
          const normalized = this.mark(`${path}.marks[${index}]`, mark);
          if (normalized) marks.push(normalized);
        });
        if (marks.length > 0) result.marks = marks;
      }
    }
    if (definition.validate) this.rules.push({ path, node: result, rule: definition.validate });
    return result;
  }
}

function structureProblems(node: ProseMirrorNode, path: string, problems: ValidationProblem[]): void {
  node.forEach((child, _offset, index) => {
    const childPath = `${path}.content[${index}]`;
    if (!node.type.allowsMarks(child.marks)) {
      problems.push({
        path: `${childPath}.marks`,
        code: "markNotAllowed",
        message: `${node.type.name} does not allow these marks on its content`,
      });
    }
    for (const [first, mark] of child.marks.entries()) {
      for (const other of child.marks.slice(first + 1)) {
        if (mark.type.excludes(other.type) || other.type.excludes(mark.type)) {
          problems.push({
            path: `${childPath}.marks`,
            code: "conflictingMarks",
            message: `The marks ${mark.type.name} and ${other.type.name} cannot be combined`,
          });
        }
      }
    }
    structureProblems(child, childPath, problems);
  });
}

export function createValidator(registry: ModuleRegistry, schema: Schema) {
  return function validate(json: unknown): ValidationResult {
    if (!isPlainObject(json)) {
      return {
        ok: false,
        problems: [{ path: "", code: "notAnObject", message: "A document must be an object" }],
      };
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(json);
    } catch {
      return {
        ok: false,
        problems: [{ path: "", code: "notSerializable", message: "The document is not valid JSON" }],
      };
    }
    if (encoder.encode(serialized).length > MAX_DOCUMENT_BYTES) {
      return {
        ok: false,
        problems: [
          { path: "", code: "tooLarge", message: `A document has at most ${MAX_DOCUMENT_BYTES} bytes` },
        ],
      };
    }
    const walker = new Walker(registry);
    let normalized: NodeJson | undefined;
    try {
      normalized = walker.node("", json, 1);
    } catch (error) {
      if (!(error instanceof LimitExceeded)) throw error;
    }
    if (walker.problems.length > 0 || !normalized) return { ok: false, problems: walker.problems };
    if (normalized.type !== "doc") {
      return {
        ok: false,
        problems: [{ path: ".type", code: "invalidContent", message: "The top node must be a doc" }],
      };
    }
    let node: ProseMirrorNode;
    try {
      node = schema.nodeFromJSON(normalized);
    } catch (error) {
      return {
        ok: false,
        problems: [{ path: "", code: "invalidContent", message: (error as Error).message }],
      };
    }
    const problems: ValidationProblem[] = [];
    structureProblems(node, "", problems);
    if (problems.length > 0) return { ok: false, problems: problems.slice(0, MAX_PROBLEMS) };
    try {
      node.check();
    } catch (error) {
      return {
        ok: false,
        problems: [{ path: "", code: "invalidContent", message: (error as Error).message }],
      };
    }
    for (const { path, node: ruleNode, rule } of walker.rules) {
      const message = rule(toValidNode(ruleNode));
      if (message) walker.problem(path, "invalidNode", message);
    }
    if (walker.problems.length > 0) return { ok: false, problems: walker.problems };
    return { ok: true, document: node.toJSON() as DocumentJson };
  };
}
