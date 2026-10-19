import { anchorAt, type TextAnchor } from "@pagehall/editor-schema";
import { IconButton, SkeletonText, useToast } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { GripVertical, PanelTopClose, PanelTopOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { CommentHighlights } from "../collaboration/comment-highlights.js";
import { checkMentionAccess } from "../collaboration/people.js";
import { type Attachment, attachmentsQuery } from "../files/attachments-api.js";
import { useUploads } from "../files/uploads.js";
import { preferenceKeys, useUpdatePreference } from "../preferences/preferences.js";
import { usePreferences } from "../preferences/preferences-provider.js";
import { useSession } from "../shell/shell-context.js";
import { type EditorActions, registerEditorActions } from "./actions.js";
import { closeCollaboration, openCollaboration, type PageCollaboration } from "./collaboration.js";
import { PageContextValue } from "./context.js";
import { EmbedDialog } from "./embed-dialog.js";
import { EmojiPicker } from "./emoji-picker.js";
import { setHeadingNumbers } from "./extensions/heading-numbers.js";
import { createEditorExtensions } from "./extensions/index.js";
import { FindBar } from "./find-bar.js";
import { LinkDialog } from "./link-dialog.js";
import { SelectionMenu, TableMenu } from "./menus.js";
import { AvatarStack, presenceColor, RemoteCarets, usePresence } from "./presence.js";
import { rememberReferences } from "./references.js";
import {
  CollaborationProblemNotice,
  SaveStateIndicator,
  useUnsavedChangesWarning,
} from "./save-indicator.js";
import type { SaveState } from "./save-state.js";
import { EditorToolbar, type ToolbarHandle } from "./toolbar.js";
import { sameToolbarItems, toolbarItems } from "./toolbar-items.js";
import "./editor.css";

export interface PageEditorProps {
  pageId: string;
  spaceId: string;
  spaceKey: string;
  showStatus?: boolean;
  draft?: boolean;
  onSaveStateChange?: (state: SaveState) => void;
  onComment?: (anchor: TextAnchor) => void;
  openThreads?: readonly string[];
  activeThread?: string | null;
  onThreadClick?: (threadId: string) => void;
  numberHeadings?: boolean;
}

const READ_ONLY_PROBLEMS = new Set(["permissionRevoked", "noEditPermission", "pageNotFound"]);

export function PageEditor(props: PageEditorProps) {
  const [collaboration, setCollaboration] = useState<PageCollaboration | null>(null);
  useEffect(() => {
    const opened = openCollaboration(props.pageId);
    setCollaboration(opened);
    return () => closeCollaboration(opened);
  }, [props.pageId]);
  if (!collaboration) return null;
  return <CollaborativeEditor key={props.pageId} {...props} collaboration={collaboration} />;
}

function CollaborativeEditor({
  pageId,
  spaceId,
  spaceKey,
  showStatus = true,
  draft = false,
  onSaveStateChange,
  onComment,
  openThreads = [],
  activeThread = null,
  onThreadClick,
  collaboration,
  numberHeadings = false,
}: PageEditorProps & { collaboration: PageCollaboration }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const attachments = useQuery({ ...attachmentsQuery(pageId), throwOnError: false });
  useEffect(() => {
    const tooLargeImages = (attachments.data ?? [])
      .filter((attachment) => attachment.tooLargeForPreview)
      .map((attachment) => attachment.id);
    if (tooLargeImages.length > 0) rememberReferences({ tooLargeImages });
  }, [attachments.data]);
  const session = useSession();
  const preferences = usePreferences();
  const updatePreference = useUpdatePreference();
  const snapshot = useSyncExternalStore(collaboration.subscribe, collaboration.getSnapshot);
  const toolbar = useRef<ToolbarHandle>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const uploads = useUploads();
  const fileInput = useRef<HTMLInputElement>(null);
  const account = session.account;
  const self = useMemo(
    () => (account ? { id: account.id, name: account.name, color: presenceColor(account.id) } : null),
    [account],
  );

  const editorRef = useRef<Editor | null>(null);
  const actions = useMemo<EditorActions>(
    () => ({
      openEmojiPicker: () => setEmojiOpen(true),
      openLinkDialog: () => setLinkOpen(true),
      openEmbedDialog: () => setEmbedOpen(true),
      openFind: () => setFindOpen(true),
      focusToolbar: () => toolbar.current?.focus(),
      ...(uploads ? { pickFiles: () => fileInput.current?.click() } : {}),
      ...(onComment
        ? {
            comment: () => {
              const current = editorRef.current;
              if (!current) return;
              const { from, to } = current.state.selection;
              const anchor = anchorAt(current.state.doc, from, to);
              if (anchor) onComment(anchor);
              else toast({ variant: "warning", title: t("comments.selectWithinParagraph") });
            },
          }
        : {}),
    }),
    [onComment, toast, t, uploads],
  );
  const insertFiles = useCallback(
    (files: File[], position: number | null) => {
      if (!uploads) return;
      uploads.start(files, (attachment: Attachment) => {
        const current = editorRef.current;
        if (!current || current.isDestroyed) return;
        const node =
          attachment.preview === "image" && !attachment.tooLargeForPreview
            ? { type: "image", attrs: { attachmentId: attachment.id, alt: attachment.name } }
            : { type: "file", attrs: { attachmentId: attachment.id, name: attachment.name } };
        const size = current.state.doc.content.size;
        const at = position !== null && position <= size ? position : current.state.selection.to;
        current.chain().insertContentAt(at, node).run();
      });
    },
    [uploads],
  );
  const onMention = useCallback(
    async (person: { id: string; name: string }) => {
      const access = await checkMentionAccess(pageId, [person.id]);
      if (access.some((entry) => !entry.hasAccess)) {
        toast({
          variant: "warning",
          title: t("mentions.noAccess", { name: person.name }),
          description: t("mentions.noAccessDescription"),
        });
      }
    },
    [pageId, toast, t],
  );

  const writable = snapshot.loaded && !(snapshot.problem && READ_ONLY_PROBLEMS.has(snapshot.problem));
  const readOnly = useRef(!writable);
  const editor = useEditor(
    {
      extensions: createEditorExtensions({
        t,
        spaceId,
        collaboration: {
          doc: collaboration.doc,
          provider: collaboration.provider,
          user: self ?? { id: "", name: "", color: presenceColor("") },
        },
        onOpenFind: actions.openFind,
        onFocusToolbar: actions.focusToolbar,
        onOpenLinkDialog: actions.openLinkDialog,
        onMention: (person) => void onMention(person),
        ...(uploads ? { onFiles: insertFiles } : {}),
      }),
      editorProps: {
        attributes: () => ({
          class: "ph-content ph-editor-content",
          "aria-label": t("editor.contentLabel"),
          "aria-multiline": "true",
          "aria-readonly": String(readOnly.current),
          role: "textbox",
        }),
      },
      editable: collaboration.getSnapshot().loaded,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
    },
    [collaboration],
  );

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (editor && self && !editor.isDestroyed) editor.commands.updateUser(self);
  }, [editor, self]);

  useEffect(() => (editor ? registerEditorActions(editor, actions) : undefined), [editor, actions]);

  useEffect(() => {
    if (editor) setHeadingNumbers(editor, numberHeadings);
  }, [editor, numberHeadings]);

  useEffect(() => {
    onSaveStateChange?.(snapshot.saveState);
  }, [snapshot.saveState, onSaveStateChange]);

  useEffect(() => {
    if (!editor) return;
    readOnly.current = !writable;
    editor.setEditable(writable);
  }, [editor, writable]);

  useEffect(() => {
    if (!editor) return;
    const onTransaction = ({ transaction }: { transaction: { getMeta(key: string): unknown } }) => {
      if (transaction.getMeta("uiEvent") !== "drop") return;
      toast({
        title: t("editor.drag.moved"),
        undo: { onUndo: () => editor.chain().focus().undo().run(), seconds: 5 },
      });
    };
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, toast, t]);

  const hasUnsavedChanges = useCallback(() => collaboration.hasUnsavedChanges, [collaboration]);
  useUnsavedChangesWarning(hasUnsavedChanges);

  const others = usePresence(collaboration.provider, self);
  const items = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? toolbarItems(current, t, actions) : []),
    equalityFn: sameToolbarItems,
  });

  const editable = useEditorState({
    editor,
    selector: ({ editor: current }) => current?.isEditable ?? false,
  });
  const pageContext = useMemo(
    () => ({ pageId, spaceId, spaceKey, provider: collaboration.provider, self }),
    [pageId, spaceId, spaceKey, collaboration.provider, self],
  );
  const blocked = snapshot.problem !== null && !snapshot.loaded;

  return (
    <PageContextValue value={pageContext}>
      <div className="ph-page-editor flex flex-col gap-3">
        {snapshot.problem ? <CollaborationProblemNotice problem={snapshot.problem} /> : null}
        {uploads ? (
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length > 0) insertFiles(files, null);
            }}
          />
        ) : null}
        {blocked || !editor ? null : (
          <>
            <div className="ph-editor-bar sticky top-0 z-10 flex flex-col gap-1 rounded-md border border-border bg-surface p-1 shadow-card">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  {preferences.editorToolbar && editable ? (
                    <EditorToolbar ref={toolbar} editor={editor} items={items ?? []} />
                  ) : null}
                </div>
                {editable ? (
                  <IconButton
                    size="sm"
                    label={t(preferences.editorToolbar ? "editor.toolbar.hide" : "editor.toolbar.show")}
                    icon={preferences.editorToolbar ? PanelTopClose : PanelTopOpen}
                    onClick={() =>
                      updatePreference.mutate({
                        key: preferenceKeys.editorToolbar,
                        value: !preferences.editorToolbar,
                      })
                    }
                  />
                ) : null}
                {showStatus ? (
                  <div className="flex shrink-0 items-center gap-2 px-1">
                    <SaveStateIndicator state={snapshot.saveState} draft={draft} />
                    <AvatarStack self={self} others={others} />
                  </div>
                ) : null}
              </div>
              {editable ? <TableMenu editor={editor} /> : null}
              {findOpen ? <FindBar editor={editor} onClose={() => setFindOpen(false)} /> : null}
            </div>
            <CommentHighlights
              scope={`[data-comment-scope="${pageId}"]`}
              open={openThreads}
              active={activeThread}
            />
            {/* biome-ignore lint/a11y/noStaticElementInteractions: clicks on comment marks open their thread, which is also reachable from the comments panel */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the comments panel offers the same threads by keyboard */}
            <div
              ref={surface}
              className="ph-editor-surface relative"
              data-comment-scope={pageId}
              onClick={(event) => {
                const mark = (event.target as HTMLElement).closest<HTMLElement>("[data-thread-id]");
                const id = mark?.dataset.threadId;
                if (id && openThreads.includes(id)) onThreadClick?.(id);
              }}
            >
              {snapshot.loaded ? null : (
                <div className="py-2">
                  <SkeletonText lines={4} />
                </div>
              )}
              <EditorContent editor={editor} />
              <RemoteCarets editor={editor} provider={collaboration.provider} container={surface} />
            </div>
            {editable ? (
              <>
                <SelectionMenu editor={editor} actions={actions} />
                <DragHandle editor={editor} className="ph-drag-handle">
                  <span className="flex size-control-sm items-center justify-center rounded-sm text-text-muted hover:bg-hover">
                    <GripVertical aria-hidden="true" className="size-icon-md" />
                    <span className="sr-only">{t("editor.drag.handle")}</span>
                  </span>
                </DragHandle>
              </>
            ) : null}
            <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
            <EmbedDialog editor={editor} open={embedOpen} onOpenChange={setEmbedOpen} />
            <EmojiPicker
              open={emojiOpen}
              onOpenChange={setEmojiOpen}
              onSelect={(emoji) =>
                editor.chain().focus().insertContent({ type: "emoji", attrs: { emoji } }).run()
              }
            />
          </>
        )}
      </div>
    </PageContextValue>
  );
}
