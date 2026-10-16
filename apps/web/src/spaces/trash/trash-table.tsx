import { Badge, Button, Table, type TableColumn } from "@pagehall/ui";
import { Layers } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFormat } from "../../preferences/preferences-provider.js";
import type { TrashEntry } from "../content-queries.js";
import { itemIcon } from "../item-icons.js";
import { itemKindLabel } from "../item-kinds.js";

export function daysUntil(date: string): number {
  return Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function KindIcon({ entry }: { entry: TrashEntry }) {
  const Icon = entry.kind === "space" ? Layers : itemIcon(entry.itemKind);
  return <Icon aria-hidden="true" className="size-icon shrink-0 text-text-muted" />;
}

export function TrashTable({
  entries,
  caption,
  showSpace = false,
  showStage = false,
  empty,
  loading,
  actions,
}: {
  entries: TrashEntry[] | undefined;
  caption: string;
  showSpace?: boolean;
  showStage?: boolean;
  empty: ReactNode;
  loading: boolean;
  actions: (entry: TrashEntry) => ReactNode;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const columns: TableColumn<TrashEntry>[] = [
    {
      key: "title",
      header: t("trash.columns.item"),
      cell: (entry) => (
        <span className="flex min-w-0 items-center gap-2">
          <KindIcon entry={entry} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium" title={entry.title}>
              {entry.title}
            </span>
            <span className="text-sm text-text-muted">
              {entry.kind === "space"
                ? t("trash.wholeSpace")
                : entry.descendants > 0
                  ? t("trash.withDescendants", { count: entry.descendants })
                  : itemKindLabel(t, entry.itemKind)}
            </span>
          </span>
        </span>
      ),
    },
    ...(showSpace
      ? [
          {
            key: "space",
            header: t("trash.columns.space"),
            hideBelow: "md" as const,
            cell: (entry: TrashEntry) => (
              <span className="truncate" title={entry.spaceName}>
                {entry.spaceName || entry.spaceKey}
              </span>
            ),
          },
        ]
      : []),
    {
      key: "deletedBy",
      header: t("trash.columns.deletedBy"),
      hideBelow: "md",
      cell: (entry) => entry.deletedBy?.name ?? t("trash.unknownPerson"),
    },
    {
      key: "deletedAt",
      header: t("trash.columns.deletedAt"),
      hideBelow: "sm",
      cell: (entry) => format.date(entry.deletedAt),
    },
    ...(showStage
      ? [
          {
            key: "stage",
            header: t("trash.columns.stage"),
            cell: (entry: TrashEntry) => (
              <Badge variant={entry.stage === 2 ? "warning" : "neutral"}>
                {entry.stage === 2 ? t("trash.stageTwo") : t("trash.stageOne")}
              </Badge>
            ),
          },
        ]
      : []),
    {
      key: "removedAt",
      header: t("trash.columns.removedIn"),
      align: "end",
      hideBelow: "sm",
      cell: (entry) => (
        <span className="tabular-nums" title={format.date(entry.removedAt)}>
          {t("trash.days", { count: daysUntil(entry.removedAt) })}
        </span>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("trash.columns.actions")}</span>,
      align: "end",
      cell: actions,
    },
  ];
  return (
    <Table
      caption={caption}
      columns={columns}
      rows={entries ?? []}
      rowKey={(entry) => entry.id}
      loading={loading}
      empty={empty}
    />
  );
}

export function RestoreButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" variant="secondary" onClick={onClick}>
      {label}
    </Button>
  );
}
