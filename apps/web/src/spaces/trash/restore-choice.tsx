import { Button, Dialog } from "@lunedo/ui";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TrashEntry } from "../content-queries.js";

export function formerParentOf(entry: TrashEntry, entries: TrashEntry[] | undefined): TrashEntry | null {
  if (!entry.formerParentEntryId) return null;
  return entries?.find((candidate) => candidate.id === entry.formerParentEntryId) ?? null;
}

export function useRestoreChoice(
  entries: TrashEntry[] | undefined,
  restore: (entry: TrashEntry, withParents: boolean) => unknown,
): { start: (entry: TrashEntry) => void; dialog: ReactNode } {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<TrashEntry | null>(null);
  const parent = asking ? formerParentOf(asking, entries) : null;
  const choose = (withParents: boolean) => {
    const entry = asking;
    setAsking(null);
    if (entry) void restore(entry, withParents);
  };
  return {
    start: (entry) => {
      if (formerParentOf(entry, entries)) setAsking(entry);
      else void restore(entry, false);
    },
    dialog: (
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => !open && setAsking(null)}
        title={t("trash.parentChoice.title", { parent: parent?.title ?? "" })}
        description={
          asking
            ? t("trash.parentChoice.description", { title: asking.title, parent: parent?.title ?? "" })
            : ""
        }
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAsking(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="secondary" onClick={() => choose(false)}>
              {t("trash.parentChoice.only", { title: asking?.title ?? "" })}
            </Button>
            <Button variant="primary" data-autofocus="" onClick={() => choose(true)}>
              {t("trash.parentChoice.both")}
            </Button>
          </>
        }
      />
    ),
  };
}
