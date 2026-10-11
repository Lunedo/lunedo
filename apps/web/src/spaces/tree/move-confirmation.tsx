import { Notice, useToast } from "@pagehall/ui";
import { useTranslation } from "react-i18next";
import { isApiError } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { ImpactConfirmDialog } from "../access/impact.js";
import type { MoveImpact } from "../space-queries.js";

export interface PendingMove {
  title: string;
  impact: MoveImpact;
  confirm: (confirmation: string) => Promise<unknown>;
}

export function moveImpactOf(error: unknown): MoveImpact | null {
  return isApiError(error, "moveChangesAccess") ? (error.problem.impact ?? null) : null;
}

export function MoveConfirmDialog({
  pending,
  onChange,
}: {
  pending: PendingMove | null;
  onChange: (pending: PendingMove | null) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  return (
    <ImpactConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) onChange(null);
      }}
      title={t("move.confirmTitle", { title: pending?.title ?? "" })}
      description={t("move.confirmDescription")}
      confirmLabel={t("move.confirm")}
      impact={{ data: pending?.impact, error: null, isPending: false, refetch: () => undefined }}
      onConfirm={async () => {
        if (!pending) return;
        try {
          await pending.confirm(pending.impact.confirmation ?? "");
        } catch (error) {
          const impact = moveImpactOf(error);
          if (impact) {
            onChange({ ...pending, impact });
            toast({ title: t("move.accessChangedAgain"), variant: "warning" });
          } else {
            toast({ title: t("tree.moveFailed"), description: problemMessage(t, error), variant: "error" });
          }
          throw error;
        }
      }}
    >
      {pending?.impact.leavesConfidential ? (
        <Notice variant="warning" title={t("confidential.moveOutTitle")}>
          {t("confidential.moveOut")}
        </Notice>
      ) : null}
    </ImpactConfirmDialog>
  );
}
