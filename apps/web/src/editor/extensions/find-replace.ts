import { type CommandProps, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface Match {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: Match[];
  current: number;
}

export const findKey = new PluginKey<FindState>("findReplace");

const EMPTY: FindState = { query: "", caseSensitive: false, matches: [], current: 0 };

export function findMatches(doc: ProseMirrorNode, query: string, caseSensitive = false): Match[] {
  if (!query) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: Match[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    let text = "";
    const offsets: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText && child.text) {
        for (let index = 0; index < child.text.length; index += 1)
          offsets.push(position + 1 + offset + index);
        text += child.text;
      } else {
        offsets.push(-1);
        text += "￼";
      }
    });
    const haystack = caseSensitive ? text : text.toLowerCase();
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      const start = offsets[index] ?? -1;
      const end = offsets[index + needle.length - 1] ?? -1;
      if (start >= 0 && end >= 0 && end - start === needle.length - 1)
        matches.push({ from: start, to: end + 1 });
      index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
    }
    return false;
  });
  return matches;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findReplace: {
      setFindQuery: (query: string, caseSensitive?: boolean) => ReturnType;
      findNext: () => ReturnType;
      findPrevious: () => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
      clearFind: () => ReturnType;
    };
  }
}

function selectCurrent(state: FindState) {
  return state.matches[state.current] ?? null;
}

export const FindReplace = Extension.create<{ onOpen: () => void }>({
  name: "findReplace",
  addOptions() {
    return { onOpen: () => undefined };
  },
  addCommands() {
    const step =
      (next: (state: FindState, doc: ProseMirrorNode) => FindState) =>
      ({ tr, state, dispatch }: CommandProps) => {
        const result = next(findKey.getState(state) ?? EMPTY, state.doc);
        if (dispatch) {
          tr.setMeta(findKey, result);
          const match = selectCurrent(result);
          if (match) tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
        }
        return true;
      };
    return {
      setFindQuery: (query, caseSensitive = false) =>
        step((_state, doc) => ({
          query,
          caseSensitive,
          matches: findMatches(doc, query, caseSensitive),
          current: 0,
        })),
      findNext: () =>
        step((state) => ({
          ...state,
          current: state.matches.length ? (state.current + 1) % state.matches.length : 0,
        })),
      findPrevious: () =>
        step((state) => ({
          ...state,
          current: state.matches.length
            ? (state.current - 1 + state.matches.length) % state.matches.length
            : 0,
        })),
      replaceCurrent:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const find = findKey.getState(state) ?? EMPTY;
          const match = selectCurrent(find);
          if (!match) return false;
          if (dispatch) {
            if (replacement) tr.insertText(replacement, match.from, match.to);
            else tr.delete(match.from, match.to);
            const matches = findMatches(tr.doc, find.query, find.caseSensitive);
            const current = matches.length ? Math.min(find.current, matches.length - 1) : 0;
            tr.setMeta(findKey, { ...find, matches, current });
          }
          return true;
        },
      replaceAll:
        (replacement) =>
        ({ tr, state, dispatch }) => {
          const find = findKey.getState(state) ?? EMPTY;
          if (find.matches.length === 0) return false;
          if (dispatch) {
            for (const match of [...find.matches].reverse()) {
              if (replacement) tr.insertText(replacement, match.from, match.to);
              else tr.delete(match.from, match.to);
            }
            tr.setMeta(findKey, {
              ...find,
              matches: findMatches(tr.doc, find.query, find.caseSensitive),
              current: 0,
            });
          }
          return true;
        },
      clearFind:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) tr.setMeta(findKey, EMPTY);
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-f": () => {
        this.options.onOpen();
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => EMPTY,
          apply(tr, value) {
            const meta = tr.getMeta(findKey) as FindState | undefined;
            if (meta) return meta;
            if (!tr.docChanged || !value.query) return value;
            const matches = findMatches(tr.doc, value.query, value.caseSensitive);
            return { ...value, matches, current: Math.min(value.current, Math.max(matches.length - 1, 0)) };
          },
        },
        props: {
          decorations(state) {
            const find = findKey.getState(state);
            if (!find || find.matches.length === 0) return DecorationSet.empty;
            return DecorationSet.create(
              state.doc,
              find.matches.map((match, index) =>
                Decoration.inline(match.from, match.to, {
                  class: index === find.current ? "ph-find-match ph-find-current" : "ph-find-match",
                }),
              ),
            );
          },
        },
      }),
    ];
  },
});
