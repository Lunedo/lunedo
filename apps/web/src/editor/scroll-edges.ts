const SCROLLERS = ".ph-roadmap-scroll";

function mark(scroller: HTMLElement, label: string): void {
  const overflowing = scroller.scrollWidth > scroller.clientWidth + 1;
  scroller.toggleAttribute("data-overflow-start", overflowing && scroller.scrollLeft > 0);
  scroller.toggleAttribute(
    "data-overflow-end",
    overflowing && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
  );
  if (overflowing) {
    scroller.setAttribute("tabindex", "0");
    scroller.setAttribute("role", "region");
    scroller.setAttribute("aria-label", label);
  } else {
    scroller.removeAttribute("tabindex");
    scroller.removeAttribute("role");
    scroller.removeAttribute("aria-label");
  }
}

export function markScrollEdges(root: HTMLElement, label: string): () => void {
  const scrollers = Array.from(root.querySelectorAll<HTMLElement>(SCROLLERS));
  if (scrollers.length === 0) return () => undefined;
  const update = () => {
    for (const scroller of scrollers) mark(scroller, label);
  };
  update();
  for (const scroller of scrollers) scroller.addEventListener("scroll", update, { passive: true });
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  for (const scroller of scrollers) observer?.observe(scroller);
  return () => {
    observer?.disconnect();
    for (const scroller of scrollers) scroller.removeEventListener("scroll", update);
  };
}
