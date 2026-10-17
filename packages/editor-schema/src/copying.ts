import type { DocumentJson, MarkJson, NodeJson } from "./json.js";
import type { CopiedAttachment, CopyMapping, ModuleRegistry } from "./module.js";

export type AttachmentAttributes = readonly (readonly [id: string, version: string | null])[];

export function copyAttachmentAttributes(pairs: AttachmentAttributes) {
  return (attrs: Record<string, unknown>, mapping: CopyMapping): Record<string, unknown> => {
    const copied = { ...attrs };
    for (const [idName, versionName] of pairs) {
      const id = attrs[idName];
      if (typeof id !== "string") continue;
      const version = versionName === null ? null : attrs[versionName];
      const mapped = mapping.attachment({ id, version: typeof version === "number" ? version : null });
      copied[idName] = mapped.id;
      if (versionName !== null && typeof version === "number") copied[versionName] = mapped.version;
    }
    return copied;
  };
}

export function copyPageAttribute(name: string, spaceName?: string) {
  return (attrs: Record<string, unknown>, mapping: CopyMapping): Record<string, unknown> => {
    const id = attrs[name];
    const mapped = typeof id === "string" ? mapping.page(id) : null;
    if (!mapped) return attrs;
    return { ...attrs, [name]: mapped.id, ...(spaceName ? { [spaceName]: mapped.spaceId } : {}) };
  };
}

function copyMarks(registry: ModuleRegistry, marks: MarkJson[], mapping: CopyMapping): MarkJson[] {
  return marks.flatMap((mark) => {
    const copy = registry.mark(mark.type)?.copy;
    if (!copy) return [mark];
    const attrs = copy(mark.attrs ?? {}, mapping);
    return attrs === null ? [] : [{ ...mark, attrs }];
  });
}

function copyNode(registry: ModuleRegistry, node: NodeJson, mapping: CopyMapping): NodeJson {
  const copy = registry.node(node.type)?.copy;
  return {
    ...node,
    ...(copy ? { attrs: copy(node.attrs ?? {}, mapping) } : {}),
    ...(node.content ? { content: node.content.map((child) => copyNode(registry, child, mapping)) } : {}),
    ...(node.marks ? { marks: copyMarks(registry, node.marks, mapping) } : {}),
  };
}

export function copyDocument(
  registry: ModuleRegistry,
  document: DocumentJson,
  mapping: CopyMapping,
): DocumentJson {
  return copyNode(registry, document, mapping) as DocumentJson;
}

export function copiedAttachments(registry: ModuleRegistry, document: DocumentJson): CopiedAttachment[] {
  const found: CopiedAttachment[] = [];
  copyDocument(registry, document, {
    attachment: (reference) => {
      found.push(reference);
      return reference;
    },
    page: () => null,
    href: (href) => href,
  });
  return found;
}
