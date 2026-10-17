import type { Roadmap } from "@pagehall/editor-schema";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useMemo } from "react";
import { usePageReferences } from "./references.js";
import { RenderedBlocks } from "./rendered-blocks.js";

export function RoadmapView({ node, selected }: NodeViewProps) {
  const roadmap = node.attrs.roadmap as Roadmap;
  const ids = useMemo(
    () => [
      ...new Set(
        roadmap.lanes.flatMap((lane) => lane.bars.flatMap((bar) => (bar.pageId ? [bar.pageId] : []))),
      ),
    ],
    [roadmap],
  );
  const pages = usePageReferences(ids);
  const references = useMemo(() => ({ people: {}, pages, topics: {} }), [pages]);
  const blocks = useMemo(() => [node.toJSON()], [node]);
  return (
    <NodeViewWrapper
      className={`ph-roadmap-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="roadmap"
    >
      <RenderedBlocks blocks={blocks} references={references} />
    </NodeViewWrapper>
  );
}
