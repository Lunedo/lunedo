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
    <span ref={ref} className={classNames("block min-w-0 truncate", className)}>
      {text}
    </span>
  );
  return truncated ? <Tooltip content={text}>{span}</Tooltip> : span;
}
