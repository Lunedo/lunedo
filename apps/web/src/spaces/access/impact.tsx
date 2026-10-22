import { ConfirmDialog, Notice, Skeleton } from "@lunedo/ui";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../../errors/failure.js";
import type { AccessImpact } from "../space-queries.js";
import { roleLabel } from "./holders.js";

const SHOWN = 8;

export interface ImpactTexts {
  noChangeTitle: string;
  noChange: string;
  gaining: (count: number) => string;
  losing: (count: number) => string;
  changing: (count: number) => string;
}

export function ImpactSummary({ impact, texts }: { impact: AccessImpact; texts?: ImpactTexts }) {
  const { t } = useTranslation();
  const words: ImpactTexts = texts ?? {
    noChangeTitle: t("spaces.impact.noChangeTitle"),
    noChange: t("spaces.impact.noChange"),
    gaining: (count) => t("spaces.impact.gaining", { count }),
    losing: (count) => t("spaces.impact.losing", { count }),
    changing: (count) => t("spaces.impact.changing", { count }),
  };
  const gaining = impact.changes.filter((change) => change.before === null);
  const losing = impact.changes.filter((change) => change.after === null);
  const changing = impact.changes.filter((change) => change.before !== null && change.after !== null);
  const total = impact.gaining + impact.losing + impact.raised + impact.lowered;
  if (total === 0) {
    return (
      <Notice variant="info" title={words.noChangeTitle}>
        {words.noChange}
      </Notice>
    );
  }
  const list = (names: string[], extra: number) => (
    <ul className="mt-2 list-disc ps-5">
      {names.slice(0, SHOWN).map((name) => (
        <li key={name}>{name}</li>
      ))}
      {names.length - Math.min(names.length, SHOWN) + extra > 0 ? (
        <li>{t("spaces.impact.andMore", { count: names.length - Math.min(names.length, SHOWN) + extra })}</li>
      ) : null}
    </ul>
  );
  const unlistedGaining = Math.max(0, impact.gaining - gaining.length);
  const unlistedLosing = Math.max(0, impact.losing - losing.length);
  return (
    <div className="flex flex-col gap-3">
      {impact.gaining > 0 ? (
        <Notice variant="info" title={words.gaining(impact.gaining)}>
          {list(
            gaining.map((change) => `${change.name} · ${roleLabel(t, change.after ?? "reader")}`),
            unlistedGaining,
          )}
        </Notice>
      ) : null}
      {impact.losing > 0 ? (
        <Notice variant="warning" title={words.losing(impact.losing)}>
          {list(
            losing.map((change) => change.name),
            unlistedLosing,
          )}
        </Notice>
      ) : null}
      {changing.length > 0 || impact.raised + impact.lowered > 0 ? (
        <Notice variant="info" title={words.changing(impact.raised + impact.lowered)}>
          {list(
            changing.map((change) =>
              t("spaces.impact.roleChange", {
                name: change.name,
                before: roleLabel(t, change.before ?? "reader"),
                after: roleLabel(t, change.after ?? "reader"),
              }),
            ),
            Math.max(0, impact.raised + impact.lowered - changing.length),
          )}
        </Notice>
      ) : null}
      {impact.unlisted > 0 ? (
        <p className="text-sm text-text-muted">{t("spaces.impact.unlisted", { count: impact.unlisted })}</p>
      ) : null}
    </div>
  );
}

export function ImpactConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  impact,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  impact: { data: AccessImpact | undefined; error: unknown; isPending: boolean; refetch: () => unknown };
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description ? { description } : {})}
      confirmLabel={confirmLabel}
      cancelLabel={t("common.cancel")}
      destructive={destructive}
      onConfirm={onConfirm}
    >
      {children}
      {impact.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {impact.error ? (
        <LoadError what={t("spaces.impact.loadFailed")} error={impact.error} onRetry={impact.refetch} />
      ) : null}
      {impact.data ? <ImpactSummary impact={impact.data} /> : null}
    </ConfirmDialog>
  );
}
