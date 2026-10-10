import { useRouter } from "@tanstack/react-router";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { createContext, useCallback, useContext } from "react";

export interface PageContext {
  pageId: string;
  spaceId: string;
  spaceKey: string;
}

export const PageContextValue = createContext<PageContext | null>(null);

export function usePageContext(): PageContext | null {
  return useContext(PageContextValue);
}

export function useOpenPath(): (path: string) => void {
  const router = useRouter({ warn: false });
  return useCallback(
    (path: string) => {
      if (router) void router.navigate({ to: path });
      else globalThis.location.assign(path);
    },
    [router],
  );
}

export function useEditable(editor: Editor): boolean {
  return useEditorState({ editor, selector: ({ editor: current }) => current.isEditable });
}
