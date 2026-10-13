export const isApplePlatform = (): boolean => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "");

export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function keyName(event: KeyPress, apple = isApplePlatform()): string {
  const parts: string[] = [];
  const mod = apple ? event.metaKey : event.ctrlKey;
  if (mod) parts.push("mod");
  if (event.altKey) parts.push("alt");
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.shiftKey && key.length > 1) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("[contenteditable]:not([contenteditable='false'])"))
    return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset", "range"].includes(type);
  }
  return ["combobox", "textbox", "searchbox"].includes(target.getAttribute("role") ?? "");
}

export interface SequenceMatcher {
  press(name: string, now?: number): string[] | null;
}

export function createSequenceMatcher(
  sequences: readonly (readonly string[])[],
  timeoutMs = 1200,
): SequenceMatcher {
  let pending: string[] = [];
  let last = 0;
  return {
    press(name, now = Date.now()) {
      if (now - last > timeoutMs) pending = [];
      last = now;
      const candidate = [...pending, name];
      const exact = sequences.find(
        (sequence) =>
          sequence.length === candidate.length && sequence.every((key, index) => key === candidate[index]),
      );
      if (exact) {
        pending = [];
        return [...exact];
      }
      const prefix = sequences.some(
        (sequence) =>
          sequence.length > candidate.length && candidate.every((key, index) => sequence[index] === key),
      );
      pending = prefix ? candidate : [];
      if (!prefix) {
        const single = sequences.find((sequence) => sequence.length === 1 && sequence[0] === name);
        if (single) return [...single];
      }
      return null;
    },
  };
}

export function displayKey(key: string, apple = isApplePlatform()): string {
  const names: Record<string, string> = apple
    ? { mod: "⌘", alt: "⌥", shift: "⇧", Escape: "Esc", Enter: "↵" }
    : { mod: "Ctrl", alt: "Alt", shift: "Shift", Escape: "Esc", Enter: "↵" };
  return key
    .split("+")
    .map((part) => names[part] ?? (part.length === 1 ? part.toUpperCase() : part))
    .join(apple ? "" : "+");
}
