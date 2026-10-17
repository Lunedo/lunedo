import { type NodeJson, renderHtml } from "@pagehall/editor-schema";
import { type MouseEvent, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "../preferences/preferences-provider.js";
import { useOpenPath } from "./context.js";
import { readViewContext } from "./read-view.js";
import type { References } from "./references.js";

export function RenderedBlocks({
  blocks,
  references,
}: {
  blocks: readonly NodeJson[];
  references: References;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const open = useOpenPath();
  const html = useMemo(() => {
    try {
      return renderHtml({ type: "doc", content: [...blocks] }, readViewContext(references, t, format));
    } catch {
      return "";
    }
  }, [blocks, references, t, format]);
  const follow = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
    const href = link?.getAttribute("href") ?? "";
    if (!href.startsWith("/") || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey)
      return;
    event.preventDefault();
    open(href);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicks come from the links inside, which are keyboard operable
    // biome-ignore lint/a11y/useKeyWithClickEvents: the links inside handle their own keyboard input
    <div
      className="ph-content ph-rendered-blocks"
      onClick={follow}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated blocks
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
