import type { RefObject } from "react";

const TYPED_INPUT = "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not(:disabled)";
const FIELDS = [
  TYPED_INPUT,
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "[contenteditable='true']",
  ":not(:disabled)[role='combobox']",
].join(", ");
const CONTROLS = [FIELDS, "button:not(:disabled)", "a[href]", ":not([tabindex='-1'])[tabindex]"].join(", ");

export function focusInitial(
  event: Event,
  content: RefObject<HTMLElement | null>,
  header: RefObject<HTMLElement | null>,
) {
  event.preventDefault();
  const root = content.current;
  if (!root) return;
  const pick = (selector: string) =>
    Array.from(root.querySelectorAll<HTMLElement>(selector)).find(
      (element) => !header.current?.contains(element),
    ) ?? null;
  (pick("[data-autofocus]") ?? pick(FIELDS) ?? pick(CONTROLS) ?? root).focus({ preventScroll: true });
}
