import { useLayoutEffect, useRef } from "react";

let menuOpener: HTMLElement | null = null;

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
  heading.focus({ preventScroll: true });
  return true;
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
