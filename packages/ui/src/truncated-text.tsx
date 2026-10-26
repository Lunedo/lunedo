import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { classNames } from "./class-names.js";
import { Tooltip } from "./tooltip.js";

export function isTruncated(element: HTMLElement): boolean {
  return element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight;
}

export function useTruncated<T extends HTMLElement>(ref: RefObject<T | null>, text: string): boolean {
  const [truncated, setTruncated] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text changes the width to measure
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setTruncated(isTruncated(element));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, text]);
  return truncated;
}

export interface TruncatedTextProps {
  text: string;
  className?: string;
}

export function TruncatedText({ text, className }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const truncated = useTruncated(ref, text);
  const span = (
    <span
      ref={ref}
      {...(truncated ? { tabIndex: 0 } : {})}
      className={classNames("block min-w-0 truncate rounded-sm focus-visible:focus-ring", className)}
    >
      {text}
    </span>
  );
  return (
    <Tooltip content={text} disabled={!truncated}>
      {span}
    </Tooltip>
  );
}
