import { Badge, Button, ConfirmDialog, Field, Notice, Popover, Textarea, useToast } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { type RefObject, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import type { SaveState } from "../editor/save-state.js";
import { problemMessage } from "../errors/problem-message.js";
import { changeMode, useContentRefresh } from "./content-actions.js";
import type { Draft } from "./content-queries.js";
import type { ItemDetails } from "./space-queries.js";

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
}: {
  page: ItemDetails;
  draft: Draft | undefined;
  saveState: RefObject<SaveState>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useContentRefresh();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = (draft?.basedOn ?? 0) + 1;
  const hiddenBy = page.ancestors.filter((ancestor) => !ancestor.published);

  const publish = async () => {
    if (note.trim().length > NOTE_MAX) {
      setError(t("versions.noteTooLong", { max: NOTE_MAX }));
      return;
    }
    setBusy(true);
    try {
      if (!(await settled(saveState))) {
        toast({
          title: t("versions.publishFailed"),
          description: t("versions.notSavedYet"),
          variant: "error",
        });
        return;
      }
      const result = await request(() =>
        api.POST("/api/v1/pages/{pageId}/publish", {
          params: { path: { pageId: page.id } },
          body: note.trim() ? { note: note.trim() } : {},
        }),
      );
      await refresh(page);
      setOpen(false);
      setNote("");
      if (result.created) {
        toast({ title: t("versions.published", { version: result.version }), variant: "success" });
      } else {
        toast({ title: t("versions.alreadyPublished", { version: result.version }) });
      }
    } catch (failure) {
      toast({
        title: t("versions.publishFailed"),
        description: problemMessage(t, failure),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      label={t("versions.publishTitle")}
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
          void publish();
        }}
      >
        <p className="text-sm text-text-muted">
          {draft?.basedOn
            ? t("versions.publishHint", { version: next, current: draft.basedOn })
            : t("versions.publishFirstHint")}
        </p>
        {hiddenBy.length > 0 ? (
          <Notice variant="warning" title={t("versions.ancestorUnpublishedTitle")}>
            {t("versions.ancestorUnpublished", {
              count: hiddenBy.length,
              names: hiddenBy
                .map((ancestor) => t("versions.quotedTitle", { title: ancestor.title }))
                .join(", "),
            })}
          </Notice>
        ) : null}
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
    <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted" role="status">
      <Badge variant="warning">{t("versions.draftBadge")}</Badge>
      <span>
        {draft.basedOn === null
          ? t("versions.notPublishedYet")
          : draft.hasChanges
            ? t("versions.changesSince", { count: draft.changes ?? 0, version: draft.basedOn })
            : t("versions.noChangesSince", { version: draft.basedOn })}
      </span>
      {draft.basedOn !== null ? (
        <span>· {t("versions.readersSee", { version: draft.basedOn })}</span>
      ) : (
        <span>· {t("versions.onlyEditorsSee")}</span>
      )}
    </p>
  );
}

export function DraftBanner({ draft, onOpen }: { draft: Draft | undefined; onOpen: () => void }) {
  const { t } = useTranslation();
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
          ? t("versions.draftBannerBy", { names: names.join(", "), count: draft.changes ?? 0 })
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
