import { type RefObject, useEffect } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest("[inert]") && element.getClientRects().length > 0,
  );
}

export function useOverlayFocusTrap(options: {
  active: boolean;
  container: RefObject<HTMLElement | null>;
  returnTo: () => HTMLElement | null;
  onEscape: () => void;
  media: string;
}): void {
  const { active, container, returnTo, onEscape, media } = options;
  useEffect(() => {
    const element = container.current;
    if (!active || !element || window.matchMedia(media).matches) return;
    const previous = document.activeElement;
    if (!element.contains(previous)) focusables(element)[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables(element);
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      const focused = document.activeElement;
      if (!focused || focused === document.body || element.contains(focused)) returnTo()?.focus();
    };
  }, [active, container, returnTo, onEscape, media]);
}
