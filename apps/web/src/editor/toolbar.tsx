import { classNames, Menu, type MenuItem, Popover, Tooltip } from "@lunedo/ui";
import type { Editor } from "@tiptap/core";
import { Ban, Baseline, ChevronDown, MoreHorizontal } from "lucide-react";
import {
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { displayKey } from "../shell/keyboard.js";
import {
  isSeparator,
  type ToolbarAction,
  type ToolbarItem,
  type ToolbarMenuEntry,
  type ToolbarSection,
} from "./toolbar-items.js";
import { fitGroups, nextIndex } from "./toolbar-model.js";

export interface ToolbarHandle {
  focus(): void;
}

const GAP_PX = 4;
const SEPARATOR_PX = 9;

function keyText(action: ToolbarAction): string | undefined {
  if (action.shortcut) return displayKey(action.shortcut);
  return action.hint;
}

function tooltipText(action: ToolbarAction): string {
  const key = keyText(action);
  return key ? `${action.label} (${key})` : action.label;
}

const BUTTON =
  "ld-toolbar-button inline-flex h-control-sm min-w-control-sm shrink-0 items-center justify-center gap-1 rounded-sm px-1 text-text hover:bg-hover aria-pressed:bg-selected aria-pressed:text-selected-text aria-expanded:bg-hover disabled:text-text-muted";

function menuEntry(entry: ToolbarMenuEntry): MenuItem {
  if (isSeparator(entry)) return { type: "separator" };
  const key = keyText(entry);
  return {
    label: entry.label,
    icon: entry.icon,
    ...(key ? { shortcut: key } : {}),
    ...(entry.disabled ? { disabled: true } : {}),
    onSelect: entry.run,
  };
}

function sectionItems(sections: ToolbarSection[]): MenuItem[] {
  return sections.flatMap((section): MenuItem[] => [
    { type: "label", label: section.label },
    ...section.actions.map(menuEntry),
  ]);
}

function overflowItems(items: ToolbarItem[]): MenuItem[] {
  return items.flatMap((item, index): MenuItem[] => {
    const separator: MenuItem[] =
      index > 0 && item.group !== items[index - 1]?.group ? [{ type: "separator" }] : [];
    if (item.palette) return [...separator, ...sectionItems(item.palette)];
    if (item.menu) return [...separator, { type: "label", label: item.label }, ...item.menu.map(menuEntry)];
    return [...separator, menuEntry(item)];
  });
}

function ButtonContent({ item }: { item: ToolbarItem }) {
  const Icon = item.icon;
  return (
    <>
      <Icon aria-hidden="true" className="size-icon-md" />
      {item.text ? <span className="max-w-field truncate px-1 text-sm font-medium">{item.text}</span> : null}
      {item.menu || item.palette ? <ChevronDown aria-hidden="true" className="size-icon-sm" /> : null}
    </>
  );
}

function Palette({ sections }: { sections: ToolbarSection[] }) {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <fieldset key={section.label} className="flex flex-col gap-1">
          <legend className="pb-1 text-xs font-semibold tracking-label text-text-muted uppercase">
            {section.label}
          </legend>
          <div className="grid grid-cols-5 gap-1">
            {section.actions.map((action, index) => {
              const color = action.id.split("-").at(-1);
              const highlight = action.id.startsWith("highlight");
              return (
                <Tooltip key={action.id} content={action.label}>
                  <button
                    type="button"
                    aria-label={action.label}
                    aria-pressed={action.active === true}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={action.run}
                    className="ld-palette-swatch inline-flex size-control-sm items-center justify-center rounded-sm border border-border font-bold aria-pressed:outline-2 aria-pressed:outline-accent focus-visible:focus-ring"
                  >
                    {index === 0 ? (
                      highlight ? (
                        <Ban aria-hidden="true" className="size-icon-md text-text-muted" />
                      ) : (
                        <Baseline aria-hidden="true" className="size-icon-md" />
                      )
                    ) : highlight ? (
                      <span
                        aria-hidden="true"
                        data-color={color}
                        className="ld-swatch-highlight size-full rounded-sm"
                      />
                    ) : (
                      <span aria-hidden="true" data-color={color} className="ld-swatch-text inline-flex">
                        <Baseline className="size-icon-md" />
                      </span>
                    )}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function ItemButton({
  item,
  tabIndex,
  onFocus,
  index,
}: {
  item: ToolbarItem;
  tabIndex: number;
  onFocus: () => void;
  index: number;
}) {
  const opens = Boolean(item.menu || item.palette);
  const button = (
    <button
      type="button"
      className={BUTTON}
      tabIndex={tabIndex}
      aria-label={item.text ? `${item.label}: ${item.text}` : item.label}
      aria-pressed={opens ? undefined : item.active ? true : undefined}
      aria-haspopup={item.menu ? "menu" : item.palette ? "dialog" : undefined}
      aria-keyshortcuts={item.shortcut}
      disabled={item.disabled}
      onFocus={onFocus}
      onMouseDown={(event) => event.preventDefault()}
      onClick={opens ? undefined : item.run}
      data-index={index}
    >
      <ButtonContent item={item} />
    </button>
  );
  if (item.palette) {
    return (
      <Tooltip content={tooltipText(item)}>
        <span className="inline-flex shrink-0">
          <Popover trigger={button} align="start" label={item.label}>
            <Palette sections={item.palette} />
          </Popover>
        </span>
      </Tooltip>
    );
  }
  if (item.menu) {
    return (
      <Tooltip content={tooltipText(item)}>
        <span className="inline-flex shrink-0">
          <Menu align="start" runAfterClose trigger={button} items={item.menu.map(menuEntry)} />
        </span>
      </Tooltip>
    );
  }
  return <Tooltip content={tooltipText(item)}>{button}</Tooltip>;
}

export const EditorToolbar = forwardRef<ToolbarHandle, { editor: Editor; items: ToolbarItem[] }>(
  function EditorToolbar({ editor, items }, ref) {
    const { t } = useTranslation();
    const container = useRef<HTMLDivElement>(null);
    const measure = useRef<HTMLDivElement>(null);
    const groups = useMemo(() => {
      const result: { id: string; movable: boolean; items: ToolbarItem[] }[] = [];
      for (const item of items) {
        const last = result.at(-1);
        if (last && last.id === item.group) last.items.push(item);
        else result.push({ id: item.group, movable: item.tier === "movable", items: [item] });
      }
      return result;
    }, [items]);
    const [fits, setFits] = useState<boolean[]>([]);
    const [focused, setFocused] = useState(0);

    useLayoutEffect(() => {
      const element = container.current;
      const ruler = measure.current;
      if (!element || !ruler) return;
      const update = () => {
        const buttons = Array.from(ruler.children) as HTMLElement[];
        const widths = buttons.map((button) => button.getBoundingClientRect().width);
        let offset = 0;
        const sizes = groups.map((group, groupIndex) => {
          const width = group.items.reduce(
            (sum, _item, index) => sum + (widths[offset + index] ?? 0) + (index > 0 ? GAP_PX : 0),
            groupIndex > 0 ? SEPARATOR_PX : 0,
          );
          offset += group.items.length;
          return { width, movable: group.movable };
        });
        const more = widths.at(-1) ?? 0;
        const next = fitGroups(sizes, element.clientWidth, more + SEPARATOR_PX, GAP_PX);
        setFits((current) =>
          current.length === next.length && current.every((value, index) => value === next[index])
            ? current
            : next,
        );
      };
      update();
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
      observer?.observe(element);
      return () => observer?.disconnect();
    }, [groups]);

    const isShown = (index: number) => fits.length !== groups.length || fits[index] === true;
    const shownGroups = groups.filter((_, index) => isShown(index));
    const shown = shownGroups.flatMap((group) => group.items);
    const hidden = groups.filter((_, index) => !isShown(index)).flatMap((group) => group.items);
    const count = shown.length + (hidden.length > 0 ? 1 : 0);

    const focusAt = useCallback((index: number) => {
      setFocused(index);
      container.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ focus: () => focusAt(Math.min(focused, Math.max(count - 1, 0))) }), [
      focused,
      count,
      focusAt,
    ]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        editor.commands.focus();
        return;
      }
      const next = nextIndex(focused, event.key, count);
      if (next === null) return;
      event.preventDefault();
      focusAt(next);
    };

    let index = -1;
    const rendered: ReactNode[] = [];
    shownGroups.forEach((group, groupIndex) => {
      if (groupIndex > 0) {
        rendered.push(
          <span
            key={`${group.id}-separator`}
            aria-hidden="true"
            className="mx-1 h-5 w-px shrink-0 bg-border"
          />,
        );
      }
      for (const item of group.items) {
        index += 1;
        const at = index;
        rendered.push(
          <ItemButton
            key={item.id}
            item={item}
            index={at}
            tabIndex={at === focused ? 0 : -1}
            onFocus={() => setFocused(at)}
          />,
        );
      }
    });

    return (
      <div className="ld-toolbar-shell relative">
        <div
          ref={container}
          role="toolbar"
          aria-label={t("editor.toolbar.label")}
          aria-orientation="horizontal"
          className="ld-toolbar-row flex min-w-0 items-center gap-1 overflow-x-auto"
          onKeyDown={onKeyDown}
        >
          {rendered}
          {hidden.length > 0 ? (
            <>
              <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />
              <Menu
                align="end"
                runAfterClose
                items={overflowItems(hidden)}
                trigger={
                  <button
                    type="button"
                    className={BUTTON}
                    aria-label={t("editor.toolbar.more")}
                    tabIndex={shown.length === focused ? 0 : -1}
                    data-index={shown.length}
                    onFocus={() => setFocused(shown.length)}
                    onMouseDown={(event) => event.preventDefault()}
                  >
                    <MoreHorizontal aria-hidden="true" className="size-icon-md" />
                  </button>
                }
              />
            </>
          ) : null}
        </div>
        <div
          ref={measure}
          aria-hidden="true"
          className={classNames("pointer-events-none invisible absolute top-0 left-0 flex gap-1")}
        >
          {items.map((item) => (
            <span key={item.id} className={BUTTON}>
              <ButtonContent item={item} />
            </span>
          ))}
          <span className={BUTTON}>
            <MoreHorizontal className="size-icon-md" />
          </span>
        </div>
      </div>
    );
  },
);
