import type { DocumentJson, MarkJson, NodeJson } from "./json.js";
import type {
  CopiedAttachment,
  FileRole,
  ModuleRegistry,
  PortableAttributes,
  PortableContext,
  PortableRemoval,
} from "./module.js";

export type PortableRemovals = Partial<Record<PortableRemoval, number>>;

function renewed(
  attrs: Record<string, unknown>,
  context: PortableContext,
  localId: string | undefined,
): Record<string, unknown> {
  return localId && context.renewsIds ? { ...attrs, [localId]: context.localId() } : attrs;
}

export function portableFiles(
  pairs: readonly (readonly [id: string, version: string | null, role: FileRole])[],
  options: { required?: boolean; localId?: string } = {},
): PortableAttributes {
  return (attrs, context) => {
    const portable = { ...attrs };
    for (const [idName, versionName, role] of pairs) {
      const id = attrs[idName];
      if (typeof id !== "string") continue;
      const version = versionName === null ? null : attrs[versionName];
      const mapped = context.file({ id, version: typeof version === "number" ? version : null }, role);
      if (!mapped) {
        context.removed("file");
        if (options.required) return null;
        portable[idName] = null;
        if (versionName !== null) portable[versionName] = null;
        continue;
      }
      portable[idName] = mapped.id;
      if (versionName !== null && typeof version === "number") portable[versionName] = mapped.version;
    }
    return renewed(portable, context, options.localId);
  };
}

export function clearedAttributes(
  kind: PortableRemoval,
  cleared: Record<string, unknown>,
  options: { localId?: string } = {},
): PortableAttributes {
  return (attrs, context) => {
    if (!context.strips(kind)) return renewed(attrs, context, options.localId);
    const portable = { ...attrs };
    let changed = false;
    for (const [name, empty] of Object.entries(cleared)) {
      if (JSON.stringify(attrs[name] ?? empty) !== JSON.stringify(empty)) changed = true;
      portable[name] = empty;
    }
    if (changed) context.removed(kind);
    return renewed(portable, context, options.localId);
  };
}

export function removedNode(kind: PortableRemoval): PortableAttributes {
  return (attrs, context) => {
    if (!context.strips(kind)) return attrs;
    context.removed(kind);
    return null;
  };
}

function portableMarks(registry: ModuleRegistry, marks: MarkJson[], context: PortableContext): MarkJson[] {
  return marks.flatMap((mark) => {
    const portable = registry.mark(mark.type)?.portable;
    if (!portable) return [mark];
    const attrs = portable(mark.attrs ?? {}, context);
    return attrs === null ? [] : [{ ...mark, attrs }];
  });
}

function portableNode(registry: ModuleRegistry, node: NodeJson, context: PortableContext): NodeJson[] {
  const definition = registry.node(node.type);
  const portable = definition?.portable;
  const attrs = portable ? portable(node.attrs ?? {}, context) : (node.attrs ?? null);
  const content = node.content?.flatMap((child) => portableNode(registry, child, context));
  if (portable && attrs === null) {
    if (content && content.length > 0) return content;
    return definition?.spec.inline ? [] : [{ type: "paragraph" }];
  }
  return [
    {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(content ? { content } : {}),
      ...(node.marks ? { marks: portableMarks(registry, node.marks, context) } : {}),
    },
  ];
}

export function portableDocument(
  registry: ModuleRegistry,
  document: DocumentJson,
  context: Omit<PortableContext, "removed">,
): { document: DocumentJson; removed: PortableRemovals } {
  const removed: PortableRemovals = {};
  const counting: PortableContext = {
    strips: (kind) => context.strips(kind),
    renewsIds: context.renewsIds,
    file: (reference, role) => context.file(reference, role),
    isInternalHref: (href) => context.isInternalHref(href),
    isBuiltInTemplate: (id) => context.isBuiltInTemplate(id),
    localId: () => context.localId(),
    removed: (kind) => {
      removed[kind] = (removed[kind] ?? 0) + 1;
    },
  };
  const [result] = portableNode(registry, document, counting);
  return { document: (result ?? { type: "doc", content: [] }) as DocumentJson, removed };
}

export function fileReferencesDocument(
  registry: ModuleRegistry,
  document: DocumentJson,
  file: (reference: CopiedAttachment, role: FileRole) => CopiedAttachment | null,
): { document: DocumentJson; missing: number } {
  const result = portableDocument(registry, document, {
    strips: () => false,
    renewsIds: false,
    file,
    isInternalHref: () => false,
    isBuiltInTemplate: () => true,
    localId: () => {
      throw new Error("Local IDs are kept when only file references change");
    },
  });
  return { document: result.document, missing: result.removed.file ?? 0 };
}
