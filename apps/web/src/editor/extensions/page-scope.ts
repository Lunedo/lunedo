import { type Editor, Extension } from "@tiptap/core";

export const PageScope = Extension.create<{ spaceId: string | null }>({
  name: "pageScope",
  addOptions() {
    return { spaceId: null };
  },
});

export function pageScopeOf(editor: Editor): string | null {
  const extension = editor.extensionManager.extensions.find((candidate) => candidate.name === "pageScope");
  const spaceId = (extension?.options as { spaceId?: unknown } | undefined)?.spaceId;
  return typeof spaceId === "string" ? spaceId : null;
}
