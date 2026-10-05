export function fitItems(widths: readonly number[], available: number, moreWidth: number, gap = 0): number {
  const total = widths.reduce((sum, width, index) => sum + width + (index > 0 ? gap : 0), 0);
  if (total <= available) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    const next = used + width + gap;
    if (next > available) break;
    used = next;
    count += 1;
  }
  return count;
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
