import {
  Badge,
  type BadgeVariant,
  Button,
  Notice,
  Section,
  SettingRow,
  Skeleton,
  Table,
  type TableColumn,
} from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type OperationsStatus,
  type OperationsStatusItem,
  operationsStatusQuery,
} from "../../api/instance-queries.js";
import { docsUrl } from "../../docs/docs-url.js";
import { LoadError } from "../../errors/failure.js";
import type { Formatter } from "../../format/format.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { SettingsPage } from "../settings/settings-page.js";

const REFRESH_MS = 60_000;
const KNOWN_ITEMS = new Set([
  "version",
  "maintenance",
  "database",
  "storage",
  "jobs",
  "collaboration",
  "backups",
  "searchIndex",
  "recentErrors",
  "tls",
  "email",
  "encryption",
  "clock",
  "fileStorage",
]);
const STATUS_BADGES: Record<string, BadgeVariant> = { ok: "success", warning: "warning", error: "danger" };

type Facts = OperationsStatusItem["facts"];

export function formattedFacts(facts: Facts, format: Formatter): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(facts)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number") {
      params[key] = key.endsWith("Bytes")
        ? format.bytes(value)
        : key === "percent"
          ? format.percent(value / 100)
          : format.number(value);
    } else if (typeof value === "string" && key.endsWith("At")) {
      params[key] = format.relative(value);
    } else {
      params[key] = String(value);
    }
  }
  return params;
}

function itemText(t: ReturnType<typeof useTranslation>["t"], item: OperationsStatusItem, format: Formatter) {
  const known = KNOWN_ITEMS.has(item.id);
  const params = formattedFacts(item.facts, format);
  const base = `operations.status.items.${item.id}`;
  return {
    label: known
      ? translateKey(t, `${base}.label`)
      : translateKey(t, "operations.status.unknownItem", { id: item.id }),
    description: known
      ? item.reason
        ? translateKey(t, `${base}.reasons.${item.reason}`, params)
        : translateKey(t, `${base}.ok`, params)
      : undefined,
  };
}

function ItemRow({ item }: { item: OperationsStatusItem }) {
  const { t } = useTranslation();
  const format = useFormat();
  const text = itemText(t, item, format);
  const fixCommand = typeof item.facts.fixCommand === "string" ? item.facts.fixCommand : null;
  return (
    <SettingRow
      label={text.label}
      description={
        <>
          {text.description}
          {fixCommand && item.status !== "ok" ? (
            <code className="mt-1 block break-all rounded-sm bg-surface-sunken px-2 py-1 font-mono text-xs">
              {fixCommand}
            </code>
          ) : null}
        </>
      }
      meta={
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          {item.page && item.status !== "ok" ? (
            <Link to={item.page} className="font-medium text-accent underline focus-visible:focus-ring">
              {t("operations.status.openSettings")}
            </Link>
          ) : null}
          <a
            href={docsUrl(item.docs)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-accent underline focus-visible:focus-ring"
          >
            {t("operations.status.documentation")}
          </a>
        </span>
      }
      control={
        <Badge variant={STATUS_BADGES[item.status] ?? "neutral"}>
          {translateKey(t, `operations.status.levels.${item.status}`)}
        </Badge>
      }
    />
  );
}

function Summary({ status }: { status: OperationsStatus }) {
  const { t } = useTranslation();
  const counts = {
    warnings: status.items.filter((item) => item.status === "warning").length,
    errors: status.items.filter((item) => item.status === "error").length,
  };
  if (status.status === "ok") {
    return (
      <Notice variant="success" title={t("operations.status.summary.okTitle")}>
        {t("operations.status.summary.ok")}
      </Notice>
    );
  }
  return (
    <Notice
      variant={status.status === "error" ? "danger" : "warning"}
      title={translateKey(t, `operations.status.summary.${status.status}Title`)}
    >
      {t("operations.status.summary.counts", counts)}
    </Notice>
  );
}

function QueuesSection({ queues }: { queues: OperationsStatus["queues"] }) {
  const { t } = useTranslation();
  const format = useFormat();
  type Queue = OperationsStatus["queues"][number];
  const count = (value: number) => format.number(value);
  const columns: TableColumn<Queue>[] = [
    {
      key: "queue",
      header: t("operations.status.queues.queue"),
      cell: (row) => <code>{row.queue}</code>,
      grow: true,
    },
    {
      key: "queued",
      header: t("operations.status.queues.queued"),
      cell: (row) => count(row.queued),
      align: "end",
    },
    {
      key: "active",
      header: t("operations.status.queues.active"),
      cell: (row) => count(row.active),
      align: "end",
    },
    {
      key: "deferred",
      header: t("operations.status.queues.deferred"),
      cell: (row) => count(row.deferred),
      align: "end",
      hideBelow: "sm",
    },
    {
      key: "failed",
      header: t("operations.status.queues.failed"),
      cell: (row) =>
        row.failed > 0 ? <Badge variant="warning">{count(row.failed)}</Badge> : count(row.failed),
      align: "end",
    },
  ];
  return (
    <Section title={t("operations.status.queues.title")}>
      <Table
        caption={t("operations.status.queues.title")}
        columns={columns}
        rows={queues}
        rowKey={(row) => row.queue}
        empty={<p className="px-4 py-3 text-sm text-text-muted">{t("operations.status.queues.empty")}</p>}
      />
    </Section>
  );
}

function ErrorsSection({ errors }: { errors: OperationsStatus["recentErrors"] }) {
  const { t } = useTranslation();
  const format = useFormat();
  type Entry = OperationsStatus["recentErrors"][number];
  const columns: TableColumn<Entry>[] = [
    {
      key: "type",
      header: t("operations.status.errors.type"),
      cell: (row) => (
        <span className="flex flex-col">
          <span>{row.type}</span>
          {row.code ? <code className="text-xs text-text-muted">{row.code}</code> : null}
        </span>
      ),
      grow: true,
    },
    {
      key: "services",
      header: t("operations.status.errors.services"),
      cell: (row) => row.services.join(", "),
      hideBelow: "sm",
    },
    {
      key: "count",
      header: t("operations.status.errors.count"),
      cell: (row) => format.number(row.count),
      align: "end",
    },
    {
      key: "lastAt",
      header: t("operations.status.errors.lastAt"),
      cell: (row) => format.relative(row.lastAt),
    },
  ];
  return (
    <Section title={t("operations.status.errors.title")}>
      <p className="px-4 pt-3 text-sm text-text-muted">{t("operations.status.errors.description")}</p>
      <Table
        caption={t("operations.status.errors.title")}
        columns={columns}
        rows={errors}
        rowKey={(row) => `${row.type}\u0000${row.code ?? ""}`}
        empty={<p className="px-4 py-3 text-sm text-text-muted">{t("operations.status.errors.empty")}</p>}
      />
    </Section>
  );
}

export function InstanceStatusScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const status = useQuery({ ...operationsStatusQuery, throwOnError: false, refetchInterval: REFRESH_MS });
  const data = status.data;
  return (
    <SettingsPage
      title={t("operations.status.title")}
      description={t("operations.status.description")}
      icon={Activity}
      actions={
        <Button
          variant="secondary"
          icon={RefreshCw}
          loading={status.isFetching}
          onClick={() => void status.refetch()}
        >
          {t("operations.status.refresh")}
        </Button>
      }
    >
      {status.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {status.isError ? (
        <LoadError
          what={t("operations.status.loadFailed")}
          error={status.error}
          onRetry={() => status.refetch()}
        />
      ) : null}
      {data ? (
        <>
          <Summary status={data} />
          <Section
            title={t("operations.status.checks")}
            actions={
              <span className="text-sm text-text-muted">
                {t("operations.status.checkedAt", { time: format.relative(data.checkedAt) })}
              </span>
            }
          >
            {data.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </Section>
          <QueuesSection queues={data.queues} />
          <ErrorsSection errors={data.recentErrors} />
        </>
      ) : null}
    </SettingsPage>
  );
}
