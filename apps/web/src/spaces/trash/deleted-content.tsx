import {
  Button,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Input,
  Menu,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import type { TrashEntry } from "../content-queries.js";
import { useRestoreFailure } from "./restore-with-parents.js";
import { TrashTable } from "./trash-table.js";

const REASON_MAX = 500;

export function DeletedContent({
  entries,
  loading,
  error,
  onRetry,
  onRestore,
  onDelete,
  showSpace = true,
}: {
  entries: TrashEntry[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onRestore: (entry: TrashEntry, withParents: boolean) => Promise<{ parentEntries: number }>;
  onDelete: (entry: TrashEntry, reason: string) => Promise<unknown>;
  showSpace?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const restoreFailed = useRestoreFailure();
  const [deleting, setDeleting] = useState<TrashEntry | null>(null);
  const restore = (entry: TrashEntry, withParents: boolean): Promise<unknown> =>
    onRestore(entry, withParents).then(
      (result) =>
        toast({
          title: t("trash.restored", { title: entry.title }),
          ...(result.parentEntries > 0 ? { description: t("trash.restoredWithParents") } : {}),
          variant: "success",
        }),
      (failure: unknown) => restoreFailed(t("trash.restoreFailed"), failure, () => restore(entry, true)),
    );
  if (error) return <LoadError what={t("trash.loadFailed")} error={error} onRetry={onRetry} />;
  return (
    <>
      <TrashTable
        entries={entries}
        caption={t("trash.deletedContent")}
        showSpace={showSpace}
        showStage
        loading={loading}
        empty={
          <EmptyState
            icon={Trash2}
            title={t("trash.nothingDeletedTitle")}
            description={t("trash.nothingDeletedDescription")}
          />
        }
        actions={(entry) => (
          <span className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => void restore(entry, false)}>
              {t("trash.restore")}
            </Button>
            <Menu
              trigger={
                <IconButton label={t("trash.moreActionsFor", { title: entry.title })} icon={MoreHorizontal} />
              }
              items={[
                {
                  label: t("trash.deleteNow"),
                  icon: Trash2,
                  danger: true,
                  onSelect: () => setDeleting(entry),
                },
              ]}
            />
          </span>
        )}
      />
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("trash.deleteNowTitle", { title: deleting?.title ?? "" })}
        size="sm"
      >
        {deleting ? (
          <DeleteNowForm
            entry={deleting}
            onCancel={() => setDeleting(null)}
            onDelete={async (reason) => {
              await onDelete(deleting, reason);
              toast({ title: t("trash.deletedNow", { title: deleting.title }), variant: "success" });
              setDeleting(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function DeleteNowForm({
  entry,
  onCancel,
  onDelete,
}: {
  entry: TrashEntry;
  onCancel: () => void;
  onDelete: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [errors, setErrors] = useState<{ reason?: string; typed?: string }>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const found: { reason?: string; typed?: string } = {};
    if (!reason.trim() || reason.trim().length > REASON_MAX)
      found.reason = t("trash.reasonRequired", { max: REASON_MAX });
    if (typed.trim() !== entry.title.trim()) found.typed = t("trash.titleMismatch");
    setErrors(found);
    if (found.reason || found.typed) {
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    try {
      await onDelete(reason.trim());
    } catch (failure) {
      toast({ title: t("trash.deleteNowFailed"), description: problemMessage(t, failure), variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-sm">
        <p>{t("trash.deleteNowConsequences")}</p>
        <ul className="mt-2 list-disc pl-5 text-text-muted">
          <li>
            {entry.kind === "space"
              ? t("trash.consequenceSpace")
              : t("trash.consequenceItems", { count: entry.descendants + 1 })}
          </li>
          {entry.kind === "items" ? <li>{t("trash.consequenceBelow")}</li> : null}
          <li>{t("trash.consequenceVersions")}</li>
          <li>{t("trash.consequenceAudit")}</li>
        </ul>
      </div>
      <Field label={t("trash.reason")} hint={t("trash.reasonHint")} error={errors.reason} required>
        <Textarea
          value={reason}
          rows={3}
          aria-invalid={errors.reason ? true : undefined}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      <Field label={t("trash.typeTitle", { title: entry.title })} error={errors.typed} required>
        <Input
          value={typed}
          aria-invalid={errors.typed ? true : undefined}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("trash.keepEntry")}
        </Button>
        <Button type="submit" variant="dangerPrimary" loading={busy}>
          {t("trash.deleteNowAction")}
        </Button>
      </div>
    </form>
  );
}
