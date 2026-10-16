import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useRouter } from "@tanstack/react-router";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { createContext, useCallback, useContext } from "react";
import type { PresenceUser } from "./presence.js";

export interface PageContext {
  pageId: string;
  spaceId: string;
  spaceKey: string;
  provider?: HocuspocusProvider;
  self?: PresenceUser | null;
}

export const PageContextValue = createContext<PageContext | null>(null);

export function usePageContext(): PageContext | null {
  return useContext(PageContextValue);
}

export function useOpenPath(): (path: string, options?: { edit?: boolean }) => void {
  const router = useRouter({ warn: false });
  return useCallback(
    (path: string, options?: { edit?: boolean }) => {
      if (router) void router.navigate({ to: path, ...(options?.edit ? { search: { edit: true } } : {}) });
      else globalThis.location.assign(options?.edit ? `${path}?edit=true` : path);
    },
    [router],
  );
}

export function useEditable(editor: Editor): boolean {
  return useEditorState({ editor, selector: ({ editor: current }) => current.isEditable });
}
