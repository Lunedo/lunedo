export type DiagramFileKind = "drawio" | "mermaid" | "plantuml" | "drawing";

export interface DiagramFile {
  kind: DiagramFileKind;
  blockId: string;
  part: "source" | "image";
}

const PATTERN =
  /^(drawio|mermaid|plantuml|drawing)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(drawio|mermaid|plantuml|excalidraw|svg)$/i;

export function diagramFile(name: string): DiagramFile | null {
  const match = PATTERN.exec(name);
  if (!match) return null;
  const kind = (match[1] ?? "").toLowerCase() as DiagramFileKind;
  const extension = (match[3] ?? "").toLowerCase();
  return { kind, blockId: (match[2] ?? "").toLowerCase(), part: extension === "svg" ? "image" : "source" };
}

export function blockSelector(file: Pick<DiagramFile, "kind" | "blockId">): string {
  return file.kind === "drawing"
    ? `[data-drawing-id="${file.blockId}"]`
    : `[data-diagram="${file.kind}"][data-diagram-id="${file.blockId}"]`;
}

export function diagramPositions(
  files: readonly Pick<DiagramFile, "kind" | "blockId">[],
  root: ParentNode,
): Map<string, number> {
  const positions = new Map<string, number>();
  const kinds = [...new Set(files.map((file) => file.kind))];
  for (const kind of kinds) {
    const selector = kind === "drawing" ? "[data-drawing-id]" : `[data-diagram="${kind}"][data-diagram-id]`;
    const inPage = [...root.querySelectorAll<HTMLElement>(selector)].map((element) =>
      (element.dataset.drawingId ?? element.dataset.diagramId ?? "").toLowerCase(),
    );
    const ordered = [
      ...new Set([...inPage, ...files.filter((file) => file.kind === kind).map((file) => file.blockId)]),
    ];
    ordered.forEach((blockId, index) => {
      if (!positions.has(blockId)) positions.set(blockId, index + 1);
    });
  }
  return positions;
}
