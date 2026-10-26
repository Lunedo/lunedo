import { anchorAt, type TextAnchor } from "@lunedo/editor-schema";
import { IconButton, SkeletonText, useToast } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { PanelTopClose, PanelTopOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CommentHighlights } from "../collaboration/comment-highlights.js";
import { ThreadCounters } from "../collaboration/inline-threads.js";
import { checkMentionAccess } from "../collaboration/people.js";
import { type Attachment, attachmentsQuery } from "../files/attachments-api.js";
import { useUploads } from "../files/uploads.js";
import { preferenceKeys, useUpdatePreference } from "../preferences/preferences.js";
import { usePreferences } from "../preferences/preferences-provider.js";
import { useSession } from "../shell/shell-context.js";
import { draftQuery } from "../spaces/content-queries.js";
import { contentQuery } from "../spaces/space-queries.js";
import { type EditorActions, registerEditorActions } from "./actions.js";
import { BlockGutter } from "./block-gutter.js";
import { closeCollaboration, openCollaboration, type PageCollaboration } from "./collaboration.js";
import { PageContextValue } from "./context.js";
import { EmbedDialog } from "./embed-dialog.js";
import { EmojiPicker } from "./emoji-picker.js";
import { setHeadingNumbers } from "./extensions/heading-numbers.js";
import { createEditorExtensions } from "./extensions/index.js";
import { type MissingSection, setRequiredSections } from "./extensions/required-sections.js";
import { FindBar } from "./find-bar.js";
import { LinkDialog } from "./link-dialog.js";
import { SelectionMenu, TableMenu } from "./menus.js";
import { AvatarStack, type PresenceUser, presenceColor, RemoteCarets, usePresence } from "./presence.js";
import { rememberReferences } from "./references.js";
import {
  CollaborationProblemNotice,
  SaveStateIndicator,
  useUnsavedChangesWarning,
} from "./save-indicator.js";
import type { SaveState } from "./save-state.js";
import { TableControls } from "./table-controls.js";
import { TableSizePicker } from "./table-size-picker.js";
import { TableGrips } from "./table-tools.js";
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
  missingSections?: readonly MissingSection[];
  toolbarContainer?: HTMLElement | null;
  onPresenceChange?: (others: PresenceUser[]) => void;
}

const READ_ONLY_PROBLEMS = new Set(["permissionRevoked", "noEditPermission", "pageNotFound", "maintenance"]);

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
  missingSections,
  toolbarContainer = null,
  onPresenceChange,
}: PageEditorProps & { collaboration: PageCollaboration }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const attachments = useQuery({ ...attachmentsQuery(pageId), throwOnError: false });
  const storedDraft = useQuery({ ...draftQuery(pageId), enabled: draft, throwOnError: false });
  const storedContent = useQuery({ ...contentQuery(pageId), enabled: !draft, throwOnError: false });
  const storedReferences = (draft ? storedDraft.data : storedContent.data)?.references;
  useEffect(() => {
    if (storedReferences) rememberReferences(storedReferences);
  }, [storedReferences]);
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
  const [tableOpen, setTableOpen] = useState(false);
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
      openTableSize: () => setTableOpen(true),
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
          class: "ld-content ld-editor-content",
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
    if (!editor || editor.isDestroyed) return;
    const missing = missingSections ?? [];
    setRequiredSections(editor, missing, (section) =>
      t("knowledgeBase.required.atSection", { title: section.title }),
    );
    const first = missing[0];
    if (!first) return;
    let target: number | null = null;
    editor.state.doc.descendants((node, position) => {
      if (target !== null) return false;
      if (node.type.name === "section" && node.attrs.key === first.key) target = position;
      return node.type.name !== "section";
    });
    const start: number | null = target;
    if (start === null) return;
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
        return true;
      })
      .scrollIntoView()
      .run();
  }, [editor, missingSections, t]);

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
  useEffect(() => {
    onPresenceChange?.(others);
  }, [others, onPresenceChange]);
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
      <div className="ld-page-editor flex flex-col gap-3">
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
            {(() => {
              const docked = toolbarContainer !== null;
              const bar = (
                <div
                  className={
                    docked
                      ? "ld-editor-bar ld-editor-bar-docked flex flex-col gap-1 px-4 py-1"
                      : "ld-editor-bar sticky top-0 z-10 flex flex-col gap-1 rounded-md border border-border bg-surface p-1 shadow-card"
                  }
                >
                  <div className={`flex min-w-0 items-center gap-2${docked ? " w-full" : ""}`}>
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
                    {showStatus && !docked ? (
                      <div className="flex shrink-0 items-center gap-2 px-1">
                        <SaveStateIndicator state={snapshot.saveState} draft={draft} />
                        <AvatarStack self={self} others={others} />
                      </div>
                    ) : null}
                  </div>
                  {editable ? (
                    <div className={docked ? "mx-auto w-full max-w-page" : undefined}>
                      <TableMenu editor={editor} />
                    </div>
                  ) : null}
                  {findOpen ? (
                    <div className={docked ? "mx-auto w-full max-w-page" : undefined}>
                      <FindBar editor={editor} onClose={() => setFindOpen(false)} />
                    </div>
                  ) : null}
                </div>
              );
              return docked ? createPortal(bar, toolbarContainer) : bar;
            })()}
            <CommentHighlights
              scope={`[data-comment-scope="${pageId}"]`}
              open={openThreads}
              active={activeThread}
            />
            {/* biome-ignore lint/a11y/noStaticElementInteractions: clicks on comment marks open their thread, which is also reachable from the counter at the edge */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the counter at the edge offers the same threads by keyboard */}
            <div
              ref={surface}
              className="ld-editor-surface relative"
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
              {editable ? <TableControls editor={editor} container={surface} /> : null}
              {editable ? <TableGrips editor={editor} container={surface} /> : null}
              {onThreadClick && openThreads.length > 0 ? (
                <ThreadCounters openThreads={openThreads} onOpen={onThreadClick} />
              ) : null}
            </div>
            {editable ? (
              <>
                <SelectionMenu editor={editor} actions={actions} />
                <BlockGutter editor={editor} />
              </>
            ) : null}
            <LinkDialog editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
            <EmbedDialog editor={editor} open={embedOpen} onOpenChange={setEmbedOpen} />
            {tableOpen ? <TableSizePicker editor={editor} open onOpenChange={setTableOpen} /> : null}
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
