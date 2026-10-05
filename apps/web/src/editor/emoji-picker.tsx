import { Dialog, Input, Spinner } from "@pagehall/ui";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface EmojiEntry {
  emoji: string;
  label: string;
  tags: string[];
  group: number;
}

interface CompactEmoji {
  unicode: string;
  label: string;
  tags?: string[];
  group?: number;
}

const RGI = /^\p{RGI_Emoji}$/v;
const COLUMNS = 8;
const MAX_SHOWN = 320;

export function usableEmoji(unicode: string): string | null {
  if (RGI.test(unicode)) return unicode;
  const plain = unicode.replace(/️/g, "");
  return RGI.test(plain) ? plain : null;
}

export function toEntries(data: readonly CompactEmoji[]): EmojiEntry[] {
  const entries: EmojiEntry[] = [];
  for (const item of data) {
    if (item.group === undefined || item.group === 2) continue;
    const emoji = usableEmoji(item.unicode);
    if (emoji) entries.push({ emoji, label: item.label, tags: item.tags ?? [], group: item.group });
  }
  return entries;
}

export function searchEmoji(entries: readonly EmojiEntry[], query: string): EmojiEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((entry) => {
    const haystack = `${entry.label} ${entry.tags.join(" ")}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

const cache = new Map<string, Promise<EmojiEntry[]>>();

function loadEmoji(language: string): Promise<EmojiEntry[]> {
  const key = language.startsWith("de") ? "de" : "en";
  let loading = cache.get(key);
  if (!loading) {
    loading = (
      key === "de" ? import("emojibase-data/de/compact.json") : import("emojibase-data/en/compact.json")
    ).then((module) => toEntries((module.default ?? module) as unknown as CompactEmoji[]));
    cache.set(key, loading);
  }
  return loading;
}

export function EmojiPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (emoji: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<EmojiEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const grid = useRef<HTMLFieldSetElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    let current = true;
    loadEmoji(i18n.language).then(
      (loaded) => current && setEntries(loaded),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [open, i18n.language]);

  const shown = useMemo(
    () => (entries ? searchEmoji(entries, query).slice(0, MAX_SHOWN) : []),
    [entries, query],
  );

  const focusCell = (index: number) => {
    setActive(index);
    grid.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
  };

  const onGridKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    if (event.key === "Home") return focusCell(0);
    if (event.key === "End") return focusCell(shown.length - 1);
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    focusCell(Math.min(Math.max(active + move, 0), shown.length - 1));
  };

  const choose = (emoji: string) => {
    onSelect(emoji);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("editor.emoji.title")} size="sm">
      <div className="flex flex-col gap-3">
        <Input
          aria-label={t("editor.emoji.search")}
          placeholder={t("editor.emoji.searchPlaceholder")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusCell(0);
            }
            if (event.key === "Enter" && shown[0]) {
              event.preventDefault();
              choose(shown[0].emoji);
            }
          }}
        />
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {t("editor.emoji.failed")}
          </p>
        ) : entries === null ? (
          <div className="flex justify-center py-4">
            <Spinner label={t("editor.emoji.loading")} />
          </div>
        ) : shown.length === 0 ? (
          <p className="text-sm text-text-muted">{t("editor.emoji.empty")}</p>
        ) : (
          <fieldset ref={grid} className="ph-emoji-grid max-h-card overflow-y-auto" onKeyDown={onGridKeyDown}>
            <legend className="sr-only">{t("editor.emoji.results", { count: shown.length })}</legend>
            {shown.map((entry, index) => (
              <button
                key={entry.emoji}
                type="button"
                data-index={index}
                tabIndex={index === active ? 0 : -1}
                aria-label={entry.label}
                title={entry.label}
                className="flex size-control-md items-center justify-center rounded-sm text-lg hover:bg-hover"
                onFocus={() => setActive(index)}
                onClick={() => choose(entry.emoji)}
              >
                {entry.emoji}
              </button>
            ))}
          </fieldset>
        )}
      </div>
    </Dialog>
  );
}
