import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { classNames } from "./class-names.js";

export interface ScrollEdges {
  start: boolean;
  end: boolean;
}

export function scrollEdges(element: HTMLElement): ScrollEdges {
  const hidden = element.scrollWidth - element.clientWidth;
  if (hidden <= 1) return { start: false, end: false };
  const offset = Math.abs(element.scrollLeft);
  return { start: offset > 1, end: offset < hidden - 1 };
}

export function useScrollEdges<T extends HTMLElement>(ref: RefObject<T | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setEdges((current) => {
        const next = scrollEdges(element);
        return current.start === next.start && current.end === next.end ? current : next;
      });
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    if (typeof ResizeObserver === "undefined") return () => element.removeEventListener("scroll", measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => {
      element.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [ref]);
  return edges;
}

export interface ScrollAreaProps {
  children: ReactNode;
  surface?: "surface" | "bg";
  label?: string;
  className?: string;
}

const FADE: Record<"surface" | "bg", { start: string; end: string }> = {
  surface: { start: "bg-linear-to-r from-surface", end: "bg-linear-to-l from-surface" },
  bg: { start: "bg-linear-to-r from-bg", end: "bg-linear-to-l from-bg" },
};

export function ScrollArea({ children, surface = "surface", label, className }: ScrollAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(ref);
  const overflowing = edges.start || edges.end;
  return (
    <div
      data-scroll-area=""
      {...(edges.start ? { "data-overflow-start": "" } : {})}
      {...(edges.end ? { "data-overflow-end": "" } : {})}
      className="relative min-w-0"
    >
      <div
        ref={ref}
        {...(overflowing && label ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}
        className={classNames("relative overflow-x-auto focus-visible:focus-ring", className)}
      >
        {children}
      </div>
      {edges.start && (
        <span
          aria-hidden="true"
          className={classNames(
            "pointer-events-none absolute inset-y-0 left-0 w-8 to-transparent",
            FADE[surface].start,
          )}
        />
      )}
      {edges.end && (
        <span
          aria-hidden="true"
          className={classNames(
            "pointer-events-none absolute inset-y-0 right-0 w-8 to-transparent",
            FADE[surface].end,
          )}
        />
      )}
    </div>
  );
}
