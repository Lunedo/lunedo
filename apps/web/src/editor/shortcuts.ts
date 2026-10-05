import { shortcuts } from "../shell/extensions.js";

const editorShortcutList: { id: string; keys: string[]; labelKey: string }[] = [
  { id: "editor.bold", keys: ["mod+b"], labelKey: "editor.toolbar.bold" },
  { id: "editor.italic", keys: ["mod+i"], labelKey: "editor.toolbar.italic" },
  { id: "editor.underline", keys: ["mod+u"], labelKey: "editor.toolbar.underline" },
  { id: "editor.strike", keys: ["mod+shift+s"], labelKey: "editor.toolbar.strike" },
  { id: "editor.code", keys: ["mod+e"], labelKey: "editor.toolbar.code" },
  { id: "editor.highlight", keys: ["mod+shift+h"], labelKey: "editor.toolbar.highlight" },
  { id: "editor.link", keys: ["mod+k"], labelKey: "editor.toolbar.link" },
  { id: "editor.paragraph", keys: ["mod+alt+0"], labelKey: "editor.blocks.paragraph" },
  { id: "editor.heading1", keys: ["mod+alt+1"], labelKey: "editor.blocks.heading1" },
  { id: "editor.heading2", keys: ["mod+alt+2"], labelKey: "editor.blocks.heading2" },
  { id: "editor.heading3", keys: ["mod+alt+3"], labelKey: "editor.blocks.heading3" },
  { id: "editor.bulletList", keys: ["mod+shift+8"], labelKey: "editor.toolbar.bulletList" },
  { id: "editor.orderedList", keys: ["mod+shift+7"], labelKey: "editor.toolbar.orderedList" },
  { id: "editor.taskList", keys: ["mod+shift+9"], labelKey: "editor.toolbar.taskList" },
  { id: "editor.indent", keys: ["mod+]"], labelKey: "editor.toolbar.indent" },
  { id: "editor.outdent", keys: ["mod+["], labelKey: "editor.toolbar.outdent" },
  { id: "editor.undo", keys: ["mod+z"], labelKey: "editor.toolbar.undo" },
  { id: "editor.redo", keys: ["mod+shift+z"], labelKey: "editor.toolbar.redo" },
  { id: "editor.find", keys: ["mod+f"], labelKey: "editor.toolbar.find" },
  { id: "editor.slash", keys: ["/"], labelKey: "editor.shortcuts.slash" },
  { id: "editor.mention", keys: ["@"], labelKey: "editor.shortcuts.mention" },
  { id: "editor.pageLink", keys: ["[["], labelKey: "editor.shortcuts.pageLink" },
  { id: "editor.toolbarFocus", keys: ["alt+F10"], labelKey: "editor.shortcuts.toolbar" },
];

export const editorShortcuts = editorShortcutList.map((shortcut, index) => ({
  ...shortcut,
  order: 1000 + index,
  group: "editor" as const,
  listOnly: true,
  run: () => undefined,
}));

shortcuts.register(...editorShortcuts);
