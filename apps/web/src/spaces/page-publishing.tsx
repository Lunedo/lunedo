import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Menu,
  type MenuItem,
  Notice,
  Popover,
  SegmentedControl,
  Textarea,
  useToast,
} from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, ChevronDown, MessageSquareText, Send, Undo2 } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import type { MissingSection } from "../editor/extensions/required-sections.js";
import type { SaveState } from "../editor/save-state.js";
import { problemMessage } from "../errors/problem-message.js";
import { changeMode, useContentRefresh } from "./content-actions.js";
import type { Draft } from "./content-queries.js";
import { contentQuery, type ItemDetails, spaceKeys } from "./space-queries.js";

const NOTE_MAX = 500;
const SAVE_WAIT_MS = 10_000;

async function settled(state: RefObject<SaveState>): Promise<boolean> {
  const deadline = Date.now() + SAVE_WAIT_MS;
  while (Date.now() < deadline) {
    if (state.current === "saved") return true;
    if (state.current === "error" || state.current === "offline") return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export function PublishButton({
  page,
  draft,
  saveState,
  onMissingSections,
  onPublished,
  onDiscard,
  article = false,
}: {
  page: ItemDetails;
  draft: Draft | undefined;
  saveState: RefObject<SaveState>;
  onMissingSections?: (sections: MissingSection[]) => void;
  onPublished?: () => void;
  onDiscard?: () => void;
  article?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useContentRefresh();
  const [open, setOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = (draft?.basedOn ?? 0) + 1;
  const update = draft !== undefined && draft.basedOn !== null;
  const failedTitle = update ? t("versions.updateFailed") : t("versions.publishFailed");
  const hiddenBy = page.ancestors.filter((ancestor) => !ancestor.published);
  const focusMovesToEditor = useRef(false);
  const hiddenNames = hiddenBy
    .map((ancestor) => t("versions.quotedTitle", { title: ancestor.title }))
    .join(", ");

  const publish = async (options: { note?: string; reviewed?: boolean } = {}): Promise<void> => {
    const text = options.note?.trim() ?? "";
    if (text.length > NOTE_MAX) {
      setError(t("versions.noteTooLong", { max: NOTE_MAX }));
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    try {
      if (!(await settled(saveState))) {
        toast({ title: failedTitle, description: t("versions.notSavedYet"), variant: "error" });
        return;
      }
      const result = await request(() =>
        api.POST("/api/v1/pages/{pageId}/publish", {
          params: { path: { pageId: page.id } },
          body: {
            ...(text ? { note: text } : {}),
            ...(article && options.reviewed ? { reviewed: true } : {}),
          },
        }),
      );
      await refresh(page);
      queryClient.removeQueries({ queryKey: spaceKeys.content(page.id), exact: true });
      await queryClient.prefetchQuery(contentQuery(page.id));
      if (article && options.reviewed && result.created) {
        await queryClient.invalidateQueries({ queryKey: ["items", page.id] });
        await queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes("reviews") });
      }
      setOpen(false);
      setNoteOpen(false);
      setNote("");
      setReviewed(false);
      setError(null);
      onMissingSections?.([]);
      if (result.created) {
        toast({
          title: update
            ? t("versions.updatedShort", { version: result.version })
            : t("versions.published", { version: result.version }),
          ...(update && hiddenBy.length > 0
            ? {
                description: t("versions.ancestorUnpublished", {
                  count: hiddenBy.length,
                  names: hiddenNames,
                }),
              }
            : {}),
          variant: "success",
        });
      } else {
        toast({ title: t("versions.alreadyPublished", { version: result.version }) });
      }
      onPublished?.();
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "requiredSectionsEmpty") {
        focusMovesToEditor.current = true;
        setOpen(false);
        setNoteOpen(false);
        onMissingSections?.(failure.problem.sections ?? []);
      }
      toast({
        title: failedTitle,
        description: problemMessage(t, failure),
        variant: "error",
        action: { label: t("errors.retry"), onSelect: () => void publish(options) },
      });
    } finally {
      setBusy(false);
    }
  };

  const noteField = (
    <Field label={t("versions.note")} hint={t("versions.noteHint")} error={error ?? undefined}>
      <Textarea
        value={note}
        rows={2}
        placeholder={t("versions.notePlaceholder")}
        onChange={(event) => {
          setNote(event.target.value);
          if (error && event.target.value.trim().length <= NOTE_MAX) setError(null);
        }}
      />
    </Field>
  );

  if (update) {
    const items: MenuItem[] = [
      { label: t("versions.updateWithNote"), icon: MessageSquareText, onSelect: () => setNoteOpen(true) },
      ...(article
        ? [
            {
              label: t("versions.updateReviewed"),
              icon: BadgeCheck,
              onSelect: () => void publish({ reviewed: true }),
            },
          ]
        : []),
      ...(onDiscard
        ? [
            { type: "separator" as const },
            { label: t("versions.discardDraft"), icon: Undo2, danger: true, onSelect: onDiscard },
          ]
        : []),
    ];
    return (
      <>
        <span className="ld-split-button inline-flex">
          <Button variant="primary" icon={Send} loading={busy} onClick={() => void publish()}>
            {t("versions.update")}
          </Button>
          <Menu
            align="end"
            items={items}
            trigger={
              <IconButton variant="primary" label={t("versions.moreUpdateOptions")} icon={ChevronDown} />
            }
          />
        </span>
        <Dialog
          open={noteOpen}
          onOpenChange={(value) => {
            setNoteOpen(value);
            if (!value) setError(null);
          }}
          title={t("versions.updateWithNoteTitle")}
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setNoteOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" loading={busy} onClick={() => void publish({ note })}>
                {t("versions.updateVersion", { version: next })}
              </Button>
            </>
          }
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void publish({ note });
            }}
          >
            {noteField}
          </form>
        </Dialog>
      </>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label={t("versions.publishTitle")}
      onCloseAutoFocus={(event) => {
        if (!focusMovesToEditor.current) return;
        focusMovesToEditor.current = false;
        event.preventDefault();
      }}
      trigger={
        <Button variant="primary" icon={Send}>
          {t("versions.publish")}
        </Button>
      }
    >
      <form
        className="flex w-card max-w-full flex-col gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void publish({ note, reviewed });
        }}
      >
        <p className="text-sm text-text-muted">{t("versions.publishFirstHint")}</p>
        {hiddenBy.length > 0 ? (
          <Notice variant="warning" title={t("versions.ancestorUnpublishedTitle")}>
            {t("versions.ancestorUnpublished", { count: hiddenBy.length, names: hiddenNames })}
          </Notice>
        ) : null}
        {noteField}
        {article ? (
          <Checkbox
            checked={reviewed}
            onCheckedChange={setReviewed}
            label={t("reviews.publish.reviewed")}
            description={t("reviews.publish.reviewedHint")}
          />
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>
            {t("versions.publishVersion", { version: next })}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

export function DraftStatusLine({ draft }: { draft: Draft | undefined }) {
  const { t } = useTranslation();
  if (!draft) return null;
  return (
    <p className="text-sm text-text-muted" role="status">
      <span className="me-2 inline-block align-middle">
        <Badge variant="warning">{t("versions.draftBadge")}</Badge>
      </span>
      <span>
        {draft.basedOn === null
          ? t("versions.notPublishedYet")
          : draft.hasChanges
            ? t("versions.changesSince", { count: draft.changes ?? 0, version: draft.basedOn })
            : t("versions.noChangesSince", { version: draft.basedOn })}
      </span>
      <span aria-hidden="true">{" ·"}</span>{" "}
      <span>
        {draft.basedOn !== null
          ? t("versions.readersSee", { version: draft.basedOn })
          : t("versions.onlyEditorsSee")}
      </span>
    </p>
  );
}

export function DraftBanner({ draft, onOpen }: { draft: Draft | undefined; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  if (!draft?.hasChanges) return null;
  const names = draft.contributors
    .map((person) => person.name)
    .filter((name): name is string => Boolean(name));
  return (
    <Notice
      variant="info"
      action={
        <Button size="sm" variant="secondary" onClick={onOpen}>
          {t("versions.openDraft")}
        </Button>
      }
    >
      {draft.basedOn === null
        ? t("versions.unpublishedBanner")
        : names.length > 0
          ? t("versions.draftBannerBy", {
              names: new Intl.ListFormat(i18n.language, { type: "conjunction" }).format(names),
              people: names.length,
              count: draft.changes ?? 0,
            })
          : t("versions.draftBanner", { count: draft.changes ?? 0 })}
    </Notice>
  );
}

export function ModeSwitchDialog({
  page,
  draft,
  open,
  onOpenChange,
}: {
  page: ItemDetails;
  draft: Draft | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useContentRefresh();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("versions.toLiveTitle")}
      description={
        draft?.basedOn === null
          ? t("versions.toLiveUnpublished")
          : t("versions.toLiveDraft", { count: draft?.changes ?? 0 })
      }
      confirmLabel={t("versions.toLiveConfirm")}
      cancelLabel={t("versions.keepPublishMode")}
      onConfirm={async () => {
        try {
          await changeMode(page.id, "live", true);
          await refresh(page);
          toast({ title: t("versions.modeLive"), variant: "success" });
        } catch (error) {
          toast({ title: t("versions.modeFailed"), description: problemMessage(t, error), variant: "error" });
        }
      }}
    />
  );
}

export function useModeSwitch(page: ItemDetails, draft: Draft | undefined, confirm: () => void) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useContentRefresh();
  const queryClient = useQueryClient();
  return async () => {
    if (page.mode === "publish" && draft?.hasChanges) {
      confirm();
      return;
    }
    try {
      await changeMode(page.id, page.mode === "publish" ? "live" : "publish");
      await refresh(page);
      await queryClient.invalidateQueries({ queryKey: ["items", page.id] });
      toast({
        title: page.mode === "publish" ? t("versions.modeLive") : t("versions.modePublish"),
        variant: "success",
      });
    } catch (error) {
      toast({ title: t("versions.modeFailed"), description: problemMessage(t, error), variant: "error" });
    }
  };
}

export type DraftViewMode = "published" | "draft";

export function DraftToggle({
  draft,
  view,
  onViewChange,
}: {
  draft: Draft | undefined;
  view: DraftViewMode;
  onViewChange: (view: DraftViewMode) => void;
}) {
  const { t } = useTranslation();
  if (!draft?.hasChanges || draft.basedOn === null) return null;
  return (
    <SegmentedControl
      label={t("versions.viewLabel")}
      value={view}
      onValueChange={(value) => onViewChange(value === "draft" ? "draft" : "published")}
      options={[
        { value: "published", label: t("versions.viewPublished") },
        { value: "draft", label: t("versions.viewDraft", { count: draft.changes ?? 0 }) },
      ]}
    />
  );
}
