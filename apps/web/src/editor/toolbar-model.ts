export interface FitOptions {
  essential?: readonly boolean[];
  alwaysMore?: boolean;
}

export function fitItems(
  widths: readonly number[],
  available: number,
  moreWidth: number,
  gap = 0,
  options: FitOptions = {},
): boolean[] {
  const total = widths.reduce((sum, width, index) => sum + width + (index > 0 ? gap : 0), 0);
  if (total <= available && !options.alwaysMore) return widths.map(() => true);
  const indices = widths.map((_, index) => index);
  const ranked = [
    ...indices.filter((index) => options.essential?.[index]),
    ...indices.filter((index) => !options.essential?.[index]),
  ];
  const shown = widths.map(() => false);
  let used = moreWidth;
  for (const index of ranked) {
    const next = used + (widths[index] ?? 0) + gap;
    if (next > available) break;
    used = next;
    shown[index] = true;
  }
  return shown;
}

export function nextIndex(current: number, key: string, length: number): number | null {
  if (length === 0) return null;
  switch (key) {
    case "ArrowRight":
      return (current + 1) % length;
    case "ArrowLeft":
      return (current - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}
