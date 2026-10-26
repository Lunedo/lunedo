export interface GroupSize {
  width: number;
  movable: boolean;
}

export function fitGroups(
  groups: readonly GroupSize[],
  available: number,
  moreWidth: number,
  gap = 0,
): boolean[] {
  const total = (shown: readonly boolean[], withMore: boolean) =>
    groups.reduce(
      (sum, group, index) => (shown[index] ? sum + group.width + gap : sum),
      withMore ? moreWidth : 0,
    );
  const shown = groups.map(() => true);
  if (total(shown, false) <= available) return shown;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    if (!groups[index]?.movable) continue;
    shown[index] = false;
    if (total(shown, true) <= available) break;
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
