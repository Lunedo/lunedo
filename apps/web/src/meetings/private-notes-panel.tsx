import type { NodeJson } from "@pagehall/editor-schema";
import { Button, IconButton, Notice, Skeleton, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { ClipboardCopy, Lock, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { isApiError, request } from "../api/request.js";
import { type EditorActions, registerEditorActions } from "../editor/actions.js";
import { createEditorExtensions } from "../editor/extensions/index.js";
import { SaveStateIndicator, useUnsavedChangesWarning } from "../editor/save-indicator.js";
import { type SaveState, TYPING_PAUSE_MS } from "../editor/save-state.js";
import { EditorToolbar } from "../editor/toolbar.js";
import { toolbarItems } from "../editor/toolbar-items.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { contentQuery } from "../spaces/space-queries.js";
import { meetingKeys, type PrivateNotes, privateNotesQuery } from "./queries.js";
import "../editor/editor.css";

function withoutIds(nodes: NodeJson[]): NodeJson[] {
  return nodes.map((node) => {
    const attrs =
      (node.type === "taskItem" || node.type === "decision") && node.attrs
        ? { ...node.attrs, id: null }
        : node.attrs;
    return {
      ...node,
      ...(attrs ? { attrs } : {}),
      ...(node.content ? { content: withoutIds(node.content) } : {}),
    };
  });
}

function selectedBlocks(editor: Editor): NodeJson[] {
  const { from, to, empty } = editor.state.selection;
  const slice = empty
    ? editor.state.doc.slice(0, editor.state.doc.content.size)
    : editor.state.doc.slice(from, to);
  const json = slice.content.toJSON() as NodeJson[] | null;
  return (json ?? []).filter((node) => node.type !== "text");
}

export function PrivateNotesPanel({
  meetingId,
  canCopy,
  onClose,
}: {
  meetingId: string;
  canCopy: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const notes = useQuery(privateNotesQuery(meetingId));
  const [generation, setGeneration] = useState(0);
  const reload = async () => {
    await notes.refetch();
    setGeneration((current) => current + 1);
  };
  return (
    <aside
      aria-label={t("meetings.notes.title")}
      className="flex h-full w-full flex-col border-l border-border bg-surface md:w-panel md:shrink-0"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Lock aria-hidden className="size-icon text-text-muted" />
        <h2 className="flex-1 font-semibold">{t("meetings.notes.title")}</h2>
        <IconButton label={t("meetings.notes.close")} icon={X} size="sm" onClick={onClose} />
      </div>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        <p className="text-sm text-text-muted">{t("meetings.notes.onlyYou")}</p>
        {notes.isPending ? <Skeleton className="h-field w-full" /> : null}
        {notes.isError ? (
          <LoadError
            what={t("meetings.notes.loadFailed")}
            error={notes.error}
            onRetry={() => notes.refetch()}
          />
        ) : null}
        {notes.data ? (
          <NotesEditor
            key={generation}
            meetingId={meetingId}
            initial={notes.data as PrivateNotes}
            canCopy={canCopy}
            onReload={() => void reload()}
          />
        ) : null}
      </div>
    </aside>
  );
}

function NotesEditor({
  meetingId,
  initial,
  canCopy,
  onReload,
}: {
  meetingId: string;
  initial: PrivateNotes;
  canCopy: boolean;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [state, setState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState(false);
  const [copying, setCopying] = useState(false);
  const revision = useRef(initial.revision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<unknown>(null);
  const saving = useRef(false);
  const actions = useMemo<EditorActions>(
    () => ({
      openEmojiPicker: () => undefined,
      openLinkDialog: () => undefined,
      openFind: () => undefined,
      focusToolbar: () => undefined,
    }),
    [],
  );

  const flush = useCallback(async () => {
    if (saving.current || pending.current === null) return;
    const document = pending.current;
    pending.current = null;
    saving.current = true;
    setState("saving");
    try {
      const saved = await request(() =>
        api.PUT("/api/v1/meetings/{meetingId}/private-notes", {
          params: { path: { meetingId } },
          body: { document, revision: revision.current } as never,
        }),
      );
      revision.current = (saved as PrivateNotes).revision;
      queryClient.setQueryData(meetingKeys.notes(meetingId), saved as PrivateNotes);
      void queryClient.invalidateQueries({ queryKey: meetingKeys.all, refetchType: "none" });
      setState(pending.current === null ? "saved" : "editing");
    } catch (failure) {
      if (isApiError(failure, "notesChanged")) setConflict(true);
      setState(navigator.onLine ? "error" : "offline");
      pending.current = pending.current ?? document;
      if (!isApiError(failure, "notesChanged")) {
        toast({
          variant: "error",
          title: t("meetings.notes.saveFailed"),
          description: problemMessage(t, failure),
        });
      }
    } finally {
      saving.current = false;
      if (pending.current !== null && !conflict)
        timer.current = setTimeout(() => void flush(), TYPING_PAUSE_MS);
    }
  }, [meetingId, queryClient, t, toast, conflict]);

  const editor = useEditor({
    extensions: createEditorExtensions({ t, spaceId: null, collaboration: null }),
    content: initial.document as object,
    editorProps: {
      attributes: {
        class: "ph-content ph-editor-content",
        "aria-label": t("meetings.notes.editorLabel"),
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: current }) => {
      pending.current = current.getJSON();
      setState("editing");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), TYPING_PAUSE_MS);
    },
  });
  useEffect(() => (editor ? registerEditorActions(editor, actions) : undefined), [editor, actions]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );
  useUnsavedChangesWarning(useCallback(() => pending.current !== null || saving.current, []));
  const items = useEditorState({
    editor,
    selector: ({ editor: current }) => (current ? toolbarItems(current, t, actions) : []),
  });

  const copy = async () => {
    if (!editor) return;
    const blocks = withoutIds(selectedBlocks(editor));
    if (blocks.length === 0) {
      toast({ variant: "warning", title: t("meetings.notes.nothingSelected") });
      return;
    }
    setCopying(true);
    try {
      const current = await queryClient.fetchQuery({ ...contentQuery(meetingId), staleTime: 0 });
      const document = current.document as { type: string; content?: NodeJson[] };
      await request(() =>
        api.PUT("/api/v1/pages/{pageId}/content", {
          params: { path: { pageId: meetingId } },
          body: { document: { ...document, content: [...(document.content ?? []), ...blocks] } as never },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: contentQuery(meetingId).queryKey });
      toast({ variant: "success", title: t("meetings.notes.copied", { count: blocks.length }) });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.notes.copyFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setCopying(false);
    }
  };

  if (!editor) return null;
  return (
    <div className="ph-page-editor flex flex-col gap-2">
      {conflict ? (
        <Notice
          variant="warning"
          title={t("meetings.notes.conflictTitle")}
          action={
            <Button size="sm" variant="secondary" onClick={onReload}>
              {t("meetings.notes.loadNewer")}
            </Button>
          }
        >
          {t("meetings.notes.conflictDescription")}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SaveStateIndicator state={state} />
        {canCopy ? (
          <Button
            size="sm"
            variant="secondary"
            icon={ClipboardCopy}
            loading={copying}
            onClick={() => void copy()}
          >
            {t("meetings.notes.copy")}
          </Button>
        ) : null}
      </div>
      <div className="rounded-md border border-border bg-surface p-1">
        <EditorToolbar editor={editor} items={items ?? []} />
      </div>
      <div className="ph-editor-surface relative min-h-field rounded-md border border-border p-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
