import { Button } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Lock, UserPlus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShareDialog, type SharedPage } from "./share-dialog.js";
import { myAccessQuery } from "./sharing-api.js";

const EDITING = new Set(["editor", "admin"]);

export interface PageSharing {
  canEditPage: boolean | null;
  shareButton: ReactNode;
  restrictionNote: ReactNode;
  dialog: ReactNode;
}

export function usePageSharing(
  page: SharedPage & { viewRestriction: "none" | "own" | "inherited"; editRestricted: boolean },
  enabled: boolean,
): PageSharing {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const mine = useQuery({ ...myAccessQuery(page.id), enabled, throwOnError: false });
  const role = mine.data?.role ?? null;
  const canShare = enabled && role !== null && EDITING.has(role);
  const restricted = page.viewRestriction !== "none" || page.editRestricted;
  const shareButton = canShare ? (
    <Button variant="secondary" icon={UserPlus} onClick={() => setOpen(true)}>
      {t("sharing.share")}
    </Button>
  ) : null;
  const restrictionNote = restricted ? (
    <p className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
      <Lock aria-hidden="true" className="size-icon shrink-0" />
      <span>
        {page.viewRestriction === "own"
          ? t("sharing.note.view")
          : page.viewRestriction === "inherited"
            ? t("sharing.note.inherited")
            : t("sharing.note.edit")}
      </span>
      {canShare ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-hit rounded-sm px-1 font-medium text-accent underline focus-visible:focus-ring"
        >
          {t("sharing.note.manage")}
        </button>
      ) : null}
    </p>
  ) : null;
  return {
    canEditPage: mine.data ? role !== null && EDITING.has(role) : null,
    shareButton,
    restrictionNote,
    dialog: canShare ? <ShareDialog page={page} open={open} onOpenChange={setOpen} /> : null,
  };
}
