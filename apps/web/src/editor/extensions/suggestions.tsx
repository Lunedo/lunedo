import { type Editor, Extension, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { type SuggestionOptions, type SuggestionProps } from "@tiptap/suggestion";
import { FilePlus, FileText } from "lucide-react";
import { searchPages } from "../references.js";
import {
  type SuggestionEntry,
  SuggestionList,
  type SuggestionListHandle,
  type SuggestionListProps,
} from "../suggestion-list.js";

export type SuggestionItem = Omit<SuggestionEntry, "select"> & { run(editor: Editor, range: Range): void };

export interface SuggestionLabels {
  label: string;
  empty: string;
  hints?: string;
}

export function suggestionRender(
  labels: () => SuggestionLabels,
): SuggestionOptions<SuggestionItem>["render"] {
  return () => {
    let renderer: ReactRenderer<SuggestionListHandle, SuggestionListProps> | null = null;
    let unmount: (() => void) | null = null;
    const propsOf = (props: SuggestionProps<SuggestionItem>): SuggestionListProps => ({
      label: labels().label,
      emptyText: labels().empty,
      ...(labels().hints ? { hints: labels().hints } : {}),
      loading: props.loading,
      items: props.items.map((item) => ({ ...item, select: () => props.command(item) })),
    });
    return {
      onStart(props) {
        renderer = new ReactRenderer(SuggestionList, { props: propsOf(props), editor: props.editor });
        const element = renderer.element as HTMLElement;
        element.classList.add("ld-suggestion-popup");
        document.body.append(element);
        unmount = props.mount(element);
      },
      onUpdate(props) {
        renderer?.updateProps(propsOf(props));
      },
      onKeyDown({ event }) {
        if (event.key === "Escape") return false;
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        unmount?.();
        renderer?.element.remove();
        renderer?.destroy();
        renderer = null;
        unmount = null;
      },
    };
  };
}

function runItem({ editor, range, props }: { editor: Editor; range: Range; props: SuggestionItem }) {
  props.run(editor, range);
}

export interface SlashOptions {
  items: (query: string) => SuggestionItem[];
  open: (query: string) => boolean;
  labels: () => SuggestionLabels;
}

export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",
  addOptions() {
    return { items: () => [], open: () => true, labels: () => ({ label: "", empty: "" }) };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestionItem, SuggestionItem>({
        pluginKey: new PluginKey("slashCommand"),
        editor: this.editor,
        char: "/",
        allowSpaces: true,
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        shouldShow: ({ query }) => this.options.open(query),
        items: ({ query }) => this.options.items(query),
        command: runItem,
        render: suggestionRender(this.options.labels),
      }),
    ];
  },
});

export interface PageLinkOptions {
  spaceId: string | null;
  labels: () => SuggestionLabels & { newPage: (title: string) => string; newPageDescription: string };
}

export const PageLinkSuggestion = Extension.create<PageLinkOptions>({
  name: "pageLinkSuggestion",
  addOptions() {
    return {
      spaceId: null,
      labels: () => ({ label: "", empty: "", newPage: (title) => title, newPageDescription: "" }),
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestionItem, SuggestionItem>({
        pluginKey: new PluginKey("pageLinkSuggestion"),
        editor: this.editor,
        char: "[[",
        allowSpaces: true,
        allowedPrefixes: null,
        allow: ({ state }) => !state.selection.$from.parent.type.spec.code,
        debounce: 200,
        items: async ({ query }) => {
          const title = query.replace(/\]+$/, "").trim();
          const found = title ? await searchPages(title).catch(() => []) : [];
          const items: SuggestionItem[] = found.map((page) => ({
            id: page.id,
            label: page.title,
            description: page.spaceName,
            icon: FileText,
            run: (editor, range) => {
              editor
                .chain()
                .focus()
                .insertContentAt(range, [
                  { type: "pageLink", attrs: { pageId: page.id, spaceId: null, title: page.title } },
                  { type: "text", text: " " },
                ])
                .run();
            },
          }));
          const exact = found.some((page) => page.title.toLowerCase() === title.toLowerCase());
          const spaceId = this.options.spaceId;
          if (title && !exact && spaceId) {
            items.push({
              id: "new",
              label: this.options.labels().newPage(title),
              description: this.options.labels().newPageDescription,
              icon: FilePlus,
              run: (editor, range) => {
                editor
                  .chain()
                  .focus()
                  .insertContentAt(range, [
                    { type: "pageLink", attrs: { pageId: null, spaceId, title: title.slice(0, 255) } },
                    { type: "text", text: " " },
                  ])
                  .run();
              },
            });
          }
          return items;
        },
        command: runItem,
        render: suggestionRender(this.options.labels),
      }),
    ];
  },
});
