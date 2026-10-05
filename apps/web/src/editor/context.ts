import { useRouter } from "@tanstack/react-router";
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
