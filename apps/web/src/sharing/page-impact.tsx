import { Button, Notice, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { type AccessChange, type PageImpact, previewAccess } from "./sharing-api.js";

const SHOWN = 6;

function Names({ names, extra }: { names: string[]; extra: number }) {
  const { t } = useTranslation();
  const hidden = names.length - Math.min(names.length, SHOWN) + extra;
  return (
    <ul className="mt-1 list-disc ps-5">
      {names.slice(0, SHOWN).map((name) => (
        <li key={name}>{name}</li>
      ))}
      {hidden > 0 ? <li>{t("spaces.impact.andMore", { count: hidden })}</li> : null}
    </ul>
  );
}

export function PageImpactSummary({ impact }: { impact: PageImpact }) {
  const { t } = useTranslation();
  const parts = [
    {
      key: "readGaining",
      count: impact.read.gaining,
      list: impact.read.changes.filter((c) => c.before === null),
    },
    {
      key: "readLosing",
      count: impact.read.losing,
      list: impact.read.changes.filter((c) => c.after === null),
    },
    {
      key: "editGaining",
      count: impact.edit.gaining,
      list: impact.edit.changes.filter((c) => c.after === "editor" && c.before !== "editor"),
    },
    {
      key: "editLosing",
      count: impact.edit.losing,
      list: impact.edit.changes.filter((c) => c.before === "editor" && c.after !== "editor"),
    },
  ] as const;
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  if (total === 0) {
    return (
      <Notice variant="info" title={t("sharing.impact.noChangeTitle")}>
        {t("sharing.impact.noChange")}
      </Notice>
    );
  }
  const unlisted = Math.max(impact.read.unlisted, impact.edit.unlisted);
  return (
    <div className="flex flex-col gap-2">
      {unlisted > 0 ? (
        <p className="text-sm text-text-muted">{t("spaces.impact.unlisted", { count: unlisted })}</p>
      ) : null}
      {parts
        .filter((part) => part.count > 0)
        .map((part) => (
          <Notice
            key={part.key}
            variant={part.key.endsWith("Losing") ? "warning" : "info"}
            title={t(`sharing.impact.${part.key}`, { count: part.count })}
          >
            <Names
              names={part.list.map((change) => change.name)}
              extra={Math.max(0, part.count - part.list.length)}
            />
          </Notice>
        ))}
    </div>
  );
}

export function PendingChange({
  pageId,
  changes,
  title,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  pageId: string;
  changes: AccessChange[];
  title: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const impact = useQuery({
    queryKey: ["items", pageId, "accessPreview", changes],
    queryFn: () => previewAccess(pageId, changes),
    gcTime: 0,
    retry: false,
  });
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-md border border-accent bg-surface p-3"
    >
      <h3 className="font-semibold">{title}</h3>
      {impact.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {impact.isError ? (
        <LoadError
          what={t("sharing.impact.loadFailed")}
          error={impact.error}
          onRetry={() => impact.refetch()}
        />
      ) : null}
      {impact.data ? <PageImpactSummary impact={impact.data} /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          disabled={impact.isError}
          loading={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            void onConfirm().finally(() => setBusy(false));
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </section>
  );
}
