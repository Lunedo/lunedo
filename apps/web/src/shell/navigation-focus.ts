import { focusMainHeading, mainHeading } from "@pagehall/ui";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

const PERSON_ACTS = ["pointerdown", "keydown", "focusin"] as const;

export function useNavigationFocus(): void {
  const pathname = useRouterState({ select: (state) => state.resolvedLocation?.pathname });
  const previous = useRef(pathname);
  useEffect(() => {
    const changed = previous.current !== undefined && previous.current !== pathname;
    previous.current = pathname;
    if (!changed) return;
    const settle = () => focusIsLost() && mainHeading() !== null && focusMainHeading();
    if (settle()) return;
    const observer = new MutationObserver(() => {
      if (settle()) stop();
    });
    const stop = () => {
      observer.disconnect();
      for (const type of PERSON_ACTS) document.removeEventListener(type, stop, true);
    };
    observer.observe(document.body, { childList: true, subtree: true });
    for (const type of PERSON_ACTS) document.addEventListener(type, stop, true);
    return stop;
  }, [pathname]);
}
