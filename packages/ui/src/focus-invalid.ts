const FOCUSABLE = "input, textarea, select, button, [tabindex]";

export function focusFirstInvalid(root: ParentNode = document): boolean {
  const invalid = root.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (!invalid) return false;
  const target = invalid.matches(FOCUSABLE) ? invalid : invalid.querySelector<HTMLElement>(FOCUSABLE);
  (target ?? invalid).focus();
  return true;
}

export function focusFirstInvalidSoon(root?: ParentNode): void {
  setTimeout(() => {
    focusFirstInvalid(root ?? document.querySelector('[role="dialog"]') ?? document);
  }, 0);
}
