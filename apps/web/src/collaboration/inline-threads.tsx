import { Drawer, Popover } from "@lunedo/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CommentAnchor, CommentPermissions } from "./comments-panel.js";
import { InlineThread } from "./page-comments.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const WIDE_QUERY = "(min-width: 48rem)";

export interface InlineThreadTarget {
  threadId: string | null;
  pending: CommentAnchor | null;
  range: Range | null;
}

export function threadMark(threadId: string): HTMLElement | null {
  if (!UUID.test(threadId)) return null;
  return document.querySelector<HTMLElement>(`[data-comment-scope] [data-thread-id="${threadId}"]`);
}

export function selectionRange(): Range | null {
  const selection = globalThis.getSelection?.();
  if (!selection || selection.rangeCount === 0) return null;
  return selection.getRangeAt(0).cloneRange();
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(WIDE_QUERY).matches ?? true);
  useEffect(() => {
    const query = globalThis.matchMedia?.(WIDE_QUERY);
    if (!query) return;
    const change = () => setWide(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return wide;
}

function returnFocusTo(target: InlineThreadTarget) {
  const mark = target.threadId ? threadMark(target.threadId) : null;
  if (mark && mark.tabIndex >= 0) {
    mark.focus();
    return;
  }
  const node = mark ?? target.range?.startContainer ?? null;
  const element = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  element?.closest<HTMLElement>("[contenteditable=true]")?.focus();
}

export function InlineThreadPopover({
  itemId,
  target,
  permissions,
  onTarget,
  onClose,
}: {
  itemId: string;
  target: InlineThreadTarget | null;
  permissions: CommentPermissions;
  onTarget: (target: InlineThreadTarget) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const wide = useWide();
  const anchor = useMemo(
    () => ({
      getBoundingClientRect: () => {
        const mark = target?.threadId ? threadMark(target.threadId) : null;
        if (mark) return mark.getBoundingClientRect();
        if (target?.range) return target.range.getBoundingClientRect();
        return new DOMRect();
      },
    }),
    [target],
  );
  if (!target) return null;
  const content = (
    <InlineThread
      itemId={itemId}
      threadId={target.threadId}
      pending={target.pending}
      permissions={permissions}
      onCreated={(threadId) => onTarget({ threadId, pending: null, range: target.range })}
      onCancel={onClose}
    />
  );
  const close = (open: boolean) => {
    if (!open) onClose();
  };
  if (!wide) {
    return (
      <Drawer open onOpenChange={close} title={t("comments.title")} side="bottom">
        <div className="p-4">{content}</div>
      </Drawer>
    );
  }
  return (
    <Popover
      open
      onOpenChange={close}
      anchor={anchor}
      align="start"
      label={t("comments.title")}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        returnFocusTo(target);
      }}
    >
      <div className="w-card max-w-full">{content}</div>
    </Popover>
  );
}

interface Counter {
  key: string;
  top: number;
  threads: string[];
}

export function ThreadCounters({
  openThreads,
  onOpen,
  onMarked,
}: {
  openThreads: readonly string[];
  onOpen: (threadId: string) => void;
  onMarked?: (threadIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const layer = useRef<HTMLDivElement>(null);
  const [counters, setCounters] = useState<Counter[]>([]);
  const reportMarked = useRef(onMarked);
  reportMarked.current = onMarked;
  const lastMarked = useRef<string | null>(null);

  useLayoutEffect(() => {
    const element = layer.current;
    const host = element?.parentElement;
    if (!element || !host) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const origin = element.getBoundingClientRect().top;
        const blocks = new Map<Element, string[]>();
        const marked: string[] = [];
        for (const id of openThreads) {
          if (!UUID.test(id)) continue;
          const mark = host.querySelector(`[data-thread-id="${id}"]`);
          const root = mark?.closest(".ld-content");
          if (!mark || !root) continue;
          marked.push(id);
          let block: Element = mark;
          while (block.parentElement && block.parentElement !== root) block = block.parentElement;
          blocks.set(block, [...(blocks.get(block) ?? []), id]);
        }
        const key = marked.join(",");
        if (key !== lastMarked.current) {
          lastMarked.current = key;
          reportMarked.current?.(marked);
        }
        const next = [...blocks.entries()].map(([block, threads]) => ({
          key: threads[0] ?? "",
          top: block.getBoundingClientRect().top - origin,
          threads,
        }));
        setCounters((current) =>
          current.length === next.length &&
          current.every((entry, index) => entry.key === next[index]?.key && entry.top === next[index]?.top)
            ? current
            : next,
        );
      });
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    const mutations = new MutationObserver(measure);
    mutations.observe(host, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [openThreads]);

  return (
    <div ref={layer} className="pointer-events-none absolute inset-y-0 -right-10 hidden w-8 md:block">
      {counters.map((counter) => (
        <button
          key={counter.key}
          type="button"
          style={{ top: counter.top }}
          aria-label={t("comments.openInBlock", { count: counter.threads.length })}
          onClick={() => {
            const first = counter.threads[0];
            if (first) onOpen(first);
          }}
          className="pointer-events-auto absolute left-0 inline-flex size-control-sm after:absolute after:top-1/2 after:left-1/2 after:size-hit after:-translate-x-1/2 after:-translate-y-1/2 items-center justify-center rounded-full bg-warning-soft text-xs font-semibold text-text hover:bg-hover focus-visible:focus-ring"
        >
          {counter.threads.length}
        </button>
      ))}
    </div>
  );
}
