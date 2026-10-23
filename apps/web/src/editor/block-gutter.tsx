import { Popover, useToast } from "@lunedo/ui";
import type { Editor } from "@tiptap/core";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { Copy, GripVertical, type LucideIcon, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

const GUTTER_BUTTON =
  "relative flex size-control-sm items-center justify-center rounded-sm text-text-muted after:absolute after:top-1/2 after:left-1/2 after:size-hit after:-translate-x-1/2 after:-translate-y-1/2 hover:bg-hover hover:text-text focus-visible:focus-ring";

interface Target {
  node: ProseMirrorNode;
  pos: number;
}

export function insertBlockBelow(editor: Editor, target: Target): boolean {
  const end = target.pos + target.node.nodeSize;
  return editor
    .chain()
    .focus()
    .insertContentAt(end, { type: "paragraph", content: [{ type: "text", text: "/" }] })
    .command(({ tr }) => {
      tr.setSelection(TextSelection.create(tr.doc, end + 2));
      return true;
    })
    .run();
}

export function duplicateBlock(editor: Editor, target: Target): boolean {
  return editor
    .chain()
    .focus()
    .insertContentAt(target.pos + target.node.nodeSize, target.node.toJSON())
    .run();
}

export function deleteBlock(editor: Editor, target: Target): boolean {
  return editor
    .chain()
    .focus()
    .deleteRange({ from: target.pos, to: target.pos + target.node.nodeSize })
    .run();
}

function BlockAction({
  icon: Icon,
  label,
  danger = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex min-h-hit w-full items-center gap-2 rounded-sm px-2 text-start text-sm hover:bg-hover focus-visible:focus-ring ${danger ? "text-danger" : "text-text"}`}
    >
      <Icon aria-hidden="true" className="size-icon-md" />
      {label}
    </button>
  );
}

export function BlockGutter({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [target, setTarget] = useState<Target | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const act = (action: (editor: Editor, target: Target) => boolean) => () => {
    setMenuOpen(false);
    if (target) action(editor, target);
  };
  return (
    <DragHandle
      editor={editor}
      className="ld-drag-handle"
      onNodeChange={({ node, pos }) => {
        if (!menuOpen) setTarget(node ? { node, pos } : null);
      }}
    >
      <span className="flex items-center">
        <button
          type="button"
          className={GUTTER_BUTTON}
          aria-label={t("editor.gutter.add")}
          title={t("editor.gutter.add")}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (target) insertBlockBelow(editor, target);
          }}
        >
          <Plus aria-hidden="true" className="size-icon-md" />
        </button>
        <Popover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="start"
          label={t("editor.gutter.menu")}
          trigger={
            <button
              type="button"
              className={`${GUTTER_BUTTON} cursor-grab`}
              aria-label={t("editor.drag.handle")}
              title={t("editor.gutter.handleHint")}
            >
              <GripVertical aria-hidden="true" className="size-icon-md" />
            </button>
          }
        >
          <div role="menu" aria-label={t("editor.gutter.menu")} className="flex min-w-field flex-col">
            <BlockAction icon={Plus} label={t("editor.gutter.insertBelow")} onClick={act(insertBlockBelow)} />
            <BlockAction icon={Copy} label={t("editor.gutter.duplicate")} onClick={act(duplicateBlock)} />
            <BlockAction
              icon={Trash2}
              label={t("editor.gutter.delete")}
              danger
              onClick={act((current, block) => {
                const deleted = deleteBlock(current, block);
                if (deleted) {
                  toast({
                    title: t("editor.gutter.deleted"),
                    undo: { onUndo: () => current.chain().focus().undo().run(), seconds: 10 },
                  });
                }
                return deleted;
              })}
            />
          </div>
        </Popover>
      </span>
    </DragHandle>
  );
}
