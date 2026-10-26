import { classNames } from "@lunedo/ui";
import { type MouseEvent, type RefObject, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const MIN_HEADINGS = 6;
export const MIN_SECTIONS = 5;
export const MAX_ALL_LEVELS = 20;
const SELECTOR = ".ld-read-view :is(h1, h2, h3)[id]";
const SECTIONS = "section:is([data-section], [data-danger-zone])";
const ACTIVE_OFFSET = 96;

export type OnThisPageSource = "headings" | "sections";

interface Entry {
  id: string;
  title: string;
  level: number;
}

function headingEntries(root: HTMLElement): Entry[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTOR)).map((heading) => ({
    id: heading.id,
    title: heading.textContent?.trim() ?? "",
    level: Number(heading.tagName.slice(1)),
  }));
}

export function anchorOf(title: string): string {
  return (
    title
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

function sectionEntries(root: HTMLElement): Entry[] {
  const used = new Set<string>();
  return Array.from(root.querySelectorAll<HTMLElement>(SECTIONS))
    .filter((section) => section.parentElement?.closest(SECTIONS) === null)
    .flatMap((section) => {
      const title = section.querySelector("h2")?.textContent?.trim() ?? "";
      if (!title) return [];
      if (!section.id) {
        let id = anchorOf(title);
        for (let index = 2; used.has(id) || root.ownerDocument.getElementById(id); index += 1) {
          id = `${anchorOf(title)}-${index}`;
        }
        section.id = id;
      }
      used.add(section.id);
      return [{ id: section.id, title, level: 2 }];
    });
}

function entriesOf(root: HTMLElement, source: OnThisPageSource): Entry[] {
  return source === "sections" ? sectionEntries(root) : headingEntries(root);
}

function shownEntries(entries: Entry[]): Entry[] {
  return entries.length > MAX_ALL_LEVELS ? entries.filter((entry) => entry.level <= 2) : entries;
}

function sameEntries(left: Entry[], right: Entry[]): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry.id === right[index]?.id && entry.title === right[index]?.title)
  );
}

export function activeHeading(
  tops: readonly { id: string; top: number }[],
  offset = ACTIVE_OFFSET,
): string | null {
  let current: string | null = tops[0]?.id ?? null;
  for (const heading of tops) {
    if (heading.top - offset <= 0) current = heading.id;
    else break;
  }
  return current;
}

export function OnThisPage({
  content,
  source = "headings",
  minimum = source === "sections" ? MIN_SECTIONS : MIN_HEADINGS,
  onShownChange,
}: {
  content: RefObject<HTMLElement | null>;
  source?: OnThisPageSource;
  minimum?: number;
  onShownChange?: (shown: boolean) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const shown = entries.length >= minimum;

  useEffect(() => {
    onShownChange?.(shown);
  }, [shown, onShownChange]);

  useEffect(() => {
    if (!shown) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id && entries.some((entry) => entry.id === id)) {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
      setActive(id);
    }
  }, [shown, entries]);

  useEffect(() => {
    const root = content.current;
    if (!root) return;
    const scan = () =>
      setEntries((current) => {
        const next = source === "sections" ? entriesOf(root, source) : shownEntries(entriesOf(root, source));
        return sameEntries(current, next) ? current : next;
      });
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [content, source]);

  useEffect(() => {
    const root = content.current;
    if (!root || !shown) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tops = entries.flatMap((entry) => {
          const element = root.ownerDocument.getElementById(entry.id);
          return element ? [{ id: entry.id, top: element.getBoundingClientRect().top }] : [];
        });
        setActive(activeHeading(tops));
      });
    };
    update();
    document.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [content, entries, shown]);

  if (!shown) return null;
  const jump = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    window.history.replaceState(window.history.state, "", `#${encodeURIComponent(id)}`);
    setActive(id);
  };
  return (
    <aside className="hidden w-sidebar shrink-0 xl:block">
      <nav
        aria-label={t("page.onThisPage")}
        className="sticky top-0 flex max-h-dvh flex-col gap-1 overflow-y-auto py-6 pr-4"
      >
        <h2 className="px-2 pb-1 text-xs font-semibold tracking-label text-text-muted uppercase">
          {t("page.onThisPage")}
        </h2>
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a
                href={`#${encodeURIComponent(entry.id)}`}
                aria-current={active === entry.id ? "location" : undefined}
                onClick={(event) => jump(event, entry.id)}
                title={entry.title}
                className={classNames(
                  "block truncate rounded-sm border-l-2 border-transparent py-1 pr-2 text-sm text-text-muted hover:text-text focus-visible:focus-ring aria-[current=location]:border-accent aria-[current=location]:font-medium aria-[current=location]:text-text",
                  entry.level === 1 ? "pl-2" : entry.level === 2 ? "pl-4" : "pl-6",
                )}
              >
                {entry.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
