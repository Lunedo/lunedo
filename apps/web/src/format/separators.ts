const SEPARATOR = /\s·\s/g;

export function keepSeparatorWithWord(text: string): string {
  return text.replace(SEPARATOR, "\u00A0· ");
}
