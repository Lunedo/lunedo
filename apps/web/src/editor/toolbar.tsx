import { classNames, Menu, type MenuItem, Tooltip } from "@lunedo/ui";
import type { Editor } from "@tiptap/core";
import { ChevronDown, MoreHorizontal } from "lucide-react";
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
import type { ToolbarAction, ToolbarItem } from "./toolbar-items.js";
import { fitItems, nextIndex } from "./toolbar-model.js";

export interface ToolbarHandle {
  focus(): void;
}

const GAP_PX = 4;
const SEPARATOR_PX = 9;

function tooltipText(action: ToolbarAction): string {
  return action.shortcut ? `${action.label} (${displayKey(action.shortcut)})` : action.label;
}

const BUTTON =
  "ld-toolbar-button inline-flex h-control-sm min-w-control-sm shrink-0 items-center justify-center gap-1 rounded-sm px-1 text-text hover:bg-hover aria-pressed:bg-selected aria-pressed:text-selected-text disabled:text-text-muted";

function menuItems(actions: ToolbarAction[]): MenuItem[] {
  return actions.map((action) => ({
    label: action.label,
    ...(action.icon ? { icon: action.icon } : {}),
    ...(action.shortcut ? { shortcut: displayKey(action.shortcut) } : {}),
    ...(action.disabled ? { disabled: true } : {}),
    onSelect: action.run,
  }));
}

function overflowItems(items: ToolbarItem[]): MenuItem[] {
  return items.flatMap((item): MenuItem[] =>
    item.menu ? [{ type: "label", label: item.label }, ...menuItems(item.menu)] : menuItems([item]),
  );
}

function ItemButton({
  item,
  tabIndex,
  onFocus,
  ...rest
}: {
  item: ToolbarItem;
  tabIndex: number;
  onFocus: () => void;
  "data-index"?: number;
}) {
  const Icon = item.icon;
  const content: ReactNode = (
    <>
      {Icon ? <Icon aria-hidden="true" className="size-icon-md" /> : null}
      {item.text ? <span className="max-w-field truncate px-1 text-sm font-medium">{item.text}</span> : null}
      {item.menu ? <ChevronDown aria-hidden="true" className="size-icon-sm" /> : null}
    </>
  );
  const button = (
    <button
      type="button"
      className={BUTTON}
      tabIndex={tabIndex}
      aria-label={item.text ? `${item.label}: ${item.text}` : item.label}
      aria-pressed={item.menu ? undefined : item.active ? true : undefined}
      aria-haspopup={item.menu ? "menu" : undefined}
      disabled={item.disabled}
      onFocus={onFocus}
      onMouseDown={(event) => event.preventDefault()}
      onClick={item.menu ? undefined : item.run}
      data-index={rest["data-index"]}
    >
      {content}
    </button>
  );
  if (item.menu) {
    return <Menu align="start" trigger={button} items={menuItems(item.menu)} />;
  }
  return <Tooltip content={tooltipText(item)}>{button}</Tooltip>;
}

export const EditorToolbar = forwardRef<ToolbarHandle, { editor: Editor; items: ToolbarItem[] }>(
  function EditorToolbar({ editor, items }, ref) {
    const { t } = useTranslation();
    const container = useRef<HTMLDivElement>(null);
    const measure = useRef<HTMLDivElement>(null);
    const main = useMemo(() => items.filter((item) => !item.overflowOnly), [items]);
    const pinned = useMemo(() => items.filter((item) => item.overflowOnly), [items]);
    const [fits, setFits] = useState<boolean[]>([]);
    const [focused, setFocused] = useState(0);

    useLayoutEffect(() => {
      const element = container.current;
      const ruler = measure.current;
      if (!element || !ruler) return;
      const update = () => {
        const buttons = Array.from(ruler.children) as HTMLElement[];
        const widths = buttons.slice(0, -1).map((button, index) => {
          const separator = index > 0 && main[index]?.group !== main[index - 1]?.group ? SEPARATOR_PX : 0;
          return button.getBoundingClientRect().width + separator;
        });
        const more = buttons.at(-1)?.getBoundingClientRect().width ?? 0;
        const next = fitItems(widths, element.clientWidth, more, GAP_PX, {
          essential: main.map((item) => item.essential === true),
          alwaysMore: pinned.length > 0,
        });
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
    }, [main, pinned]);

    const isShown = (index: number) => fits.length === 0 || fits[index] === true;
    const shown = main.filter((_, index) => isShown(index));
    const hidden = [...main.filter((_, index) => !isShown(index)), ...pinned];
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

    return (
      <div className="ld-toolbar-shell relative">
        <div
          ref={container}
          role="toolbar"
          aria-label={t("editor.toolbar.label")}
          aria-orientation="horizontal"
          className="flex min-w-0 items-center gap-1 overflow-hidden"
          onKeyDown={onKeyDown}
        >
          {shown.map((item, index) => (
            <span key={item.id} className="flex items-center">
              {index > 0 && item.group !== shown[index - 1]?.group ? (
                <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
              ) : null}
              <ItemButton
                item={item}
                tabIndex={index === focused ? 0 : -1}
                onFocus={() => setFocused(index)}
                data-index={index}
              />
            </span>
          ))}
          {hidden.length > 0 ? (
            <Menu
              align="end"
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
          ) : null}
        </div>
        <div
          ref={measure}
          aria-hidden="true"
          className={classNames("pointer-events-none invisible absolute top-0 left-0 flex gap-1")}
        >
          {main.map((item) => {
            const Icon = item.icon;
            return (
              <span key={item.id} className={BUTTON}>
                {Icon ? <Icon className="size-icon-md" /> : null}
                {item.text ? (
                  <span className="max-w-field truncate px-1 text-sm font-medium">{item.text}</span>
                ) : null}
                {item.menu ? <ChevronDown className="size-icon-sm" /> : null}
              </span>
            );
          })}
          <span className={BUTTON}>
            <MoreHorizontal className="size-icon-md" />
          </span>
        </div>
      </div>
    );
  },
);
