import { useCallback, useLayoutEffect, useRef } from "react";

let menuOpener: HTMLElement | null = null;
let keyboardUsed = false;

if (typeof document !== "undefined") {
  document.addEventListener(
    "keydown",
    (event) => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey) keyboardUsed = true;
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    () => {
      keyboardUsed = false;
    },
    true,
  );
}

export function rememberMenuOpener(trigger: HTMLElement | null): void {
  menuOpener = trigger;
  setTimeout(() => {
    if (menuOpener === trigger) menuOpener = null;
  }, 0);
}

export function mainHeading(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>("main h1, [role='main'] h1, h1");
}

export function focusMainHeading(root: ParentNode = document): boolean {
  const heading = mainHeading(root);
  if (!heading) return false;
  if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
  if (keyboardUsed) heading.removeAttribute("data-quiet-focus");
  else {
    heading.setAttribute("data-quiet-focus", "");
    heading.addEventListener("blur", () => heading.removeAttribute("data-quiet-focus"), { once: true });
  }
  heading.focus({ preventScroll: true });
  return true;
}

export function useOpener(): () => void {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }, []);
  return useCallback(() => {
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected) target.focus();
    else focusMainHeading();
  }, []);
}

export function focusWhenShown(find: () => HTMLElement | null | undefined, attempts = 20): void {
  const step = (left: number) => {
    const element = find();
    if (element) element.focus();
    else if (left > 0) setTimeout(() => step(left - 1), 50);
  };
  setTimeout(() => step(attempts), 0);
}

export function useReturnFocus(open: boolean): (event: Event) => void {
  const previous = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (menuOpener?.isConnected) previous.current = menuOpener;
    else if (active instanceof HTMLElement && active !== document.body) previous.current = active;
    menuOpener = null;
  }, [open]);
  return (event) => {
    const target = previous.current;
    previous.current = null;
    event.preventDefault();
    if (target?.isConnected) target.focus();
    else focusMainHeading();
  };
}
