import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface FileDropOptions {
  onFiles: ((files: File[], position: number | null) => void) | null;
}

export const FileDrop = Extension.create<FileDropOptions>({
  name: "fileDrop",
  addOptions() {
    return { onFiles: null };
  },
  addProseMirrorPlugins() {
    const onFiles = this.options.onFiles;
    if (!onFiles) return [];
    return [
      new Plugin({
        key: new PluginKey("fileDrop"),
        props: {
          handlePaste(view, event) {
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length === 0) return false;
            event.preventDefault();
            onFiles(files, view.state.selection.from);
            return true;
          },
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return false;
            event.preventDefault();
            const place = view.posAtCoords({ left: event.clientX, top: event.clientY });
            onFiles(files, place?.pos ?? null);
            return true;
          },
        },
      }),
    ];
  },
});
