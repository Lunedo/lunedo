import {
  Badge,
  type BadgeVariant,
  Button,
  CollapsibleSection,
  classNames,
  Icon,
  Notice,
  Section,
  Skeleton,
  Table,
  type TableColumn,
  TruncatedText,
} from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlert, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
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

function ProblemCard({ item }: { item: OperationsStatusItem }) {
  const { t } = useTranslation();
  const format = useFormat();
  const text = itemText(t, item, format);
  const fixCommand = typeof item.facts.fixCommand === "string" ? item.facts.fixCommand : null;
  const cleanupAt =
    item.id === "backups" && typeof item.facts.testRestoreCleanupAt === "string"
      ? item.facts.testRestoreCleanupAt
      : null;
  const error = item.status === "error";
  return (
    <li
      data-problem={item.id}
      className={classNames(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-border border-l-4 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        error ? "border-l-danger" : "border-l-warning",
      )}
    >
      <Icon
        icon={error ? CircleAlert : TriangleAlert}
        className={classNames("mt-0.5", error ? "text-danger" : "text-warning")}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold">{text.label}</span>
        {text.description ? <span className="text-sm text-text-muted">{text.description}</span> : null}
        {cleanupAt ? (
          <span className="text-sm text-text-muted">
            {t("operations.status.items.backups.cleanup", {
              testRestoreCleanupAt: format.relative(cleanupAt),
            })}
          </span>
        ) : null}
        {fixCommand ? (
          <code className="block break-all rounded-sm bg-surface-sunken px-2 py-1 font-mono text-xs">
            {fixCommand}
          </code>
        ) : null}
        <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {item.page ? (
            <Link to={item.page} className="font-medium text-accent hover:underline focus-visible:focus-ring">
              {t("operations.status.openSettings")}
            </Link>
          ) : null}
          <a
            href={docsUrl(item.docs)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline focus-visible:focus-ring"
          >
            {t("operations.status.documentation")}
            <Icon icon={ExternalLink} size="sm" />
          </a>
        </span>
      </div>
      <span className="col-start-2 sm:col-start-auto">
        <Badge variant={STATUS_BADGES[item.status] ?? "neutral"}>
          {translateKey(t, `operations.status.levels.${item.status}`)}
        </Badge>
      </span>
    </li>
  );
}

function Tile({ value, label, attention }: { value: string; label: string; attention?: boolean }) {
  return (
    <div
      data-status-tile=""
      className={classNames(
        "flex min-w-0 flex-col rounded-lg border px-4 py-3",
        attention ? "border-warning bg-warning-soft" : "border-border",
      )}
    >
      <span
        className={classNames("text-xl font-semibold tabular-nums", attention ? "text-warning" : "text-text")}
      >
        {value}
      </span>
      <span className="text-sm text-text-muted">{label}</span>
    </div>
  );
}

function Tiles({ status }: { status: OperationsStatus }) {
  const { t } = useTranslation();
  const format = useFormat();
  const problems = status.items.filter((item) => item.status !== "ok").length;
  const ok = status.items.length - problems;
  const jobs = status.queues.reduce((sum, queue) => sum + queue.queued + queue.active, 0);
  const errors = status.recentErrors.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile
        value={format.number(problems)}
        label={t("operations.status.tiles.attention")}
        attention={problems > 0}
      />
      <Tile value={format.number(ok)} label={t("operations.status.tiles.ok")} />
      <Tile value={format.number(jobs)} label={t("operations.status.tiles.jobs")} />
      <Tile
        value={format.number(errors)}
        label={t("operations.status.tiles.errors")}
        attention={errors > 0}
      />
    </div>
  );
}

function HealthyChecks({ items }: { items: OperationsStatusItem[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  if (items.length === 0) return null;
  return (
    <CollapsibleSection
      title={
        <>
          {t("operations.status.healthy")}{" "}
          <span className="font-normal text-text-muted">
            {t("operations.status.checksCount", { count: items.length })}
          </span>
        </>
      }
    >
      <div className="pt-3">
        <Table
          caption={t("operations.status.healthy")}
          rowKey={(item) => item.id}
          rows={items}
          columns={[
            {
              key: "check",
              header: t("operations.status.check"),
              cell: (item) => <span className="font-medium">{itemText(t, item, format).label}</span>,
            },
            {
              key: "result",
              header: t("operations.status.result"),
              grow: true,
              hideBelow: "sm",
              cell: (item) => (
                <TruncatedText
                  text={itemText(t, item, format).description ?? ""}
                  className="text-text-muted"
                />
              ),
            },
            {
              key: "status",
              header: t("operations.status.statusColumn"),
              align: "end",
              cell: (item) => (
                <Badge variant={STATUS_BADGES[item.status] ?? "neutral"}>
                  {translateKey(t, `operations.status.levels.${item.status}`)}
                </Badge>
              ),
            },
          ]}
        />
      </div>
    </CollapsibleSection>
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
    {
      key: "oldest",
      header: t("operations.status.queues.oldest"),
      cell: (row) => (
        <span className="whitespace-nowrap text-text-muted">
          {row.oldestQueuedAt ? format.relative(row.oldestQueuedAt) : "—"}
        </span>
      ),
      align: "end",
      hideBelow: "md",
    },
  ];
  return (
    <Section
      title={t("operations.status.queues.title")}
      description={t("operations.status.queues.description")}
    >
      <Table
        caption={t("operations.status.queues.title")}
        columns={columns}
        rows={queues}
        rowKey={(row) => row.queue}
        empty={<p className="py-3 text-sm text-text-muted">{t("operations.status.queues.empty")}</p>}
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
      <p className="pt-3 text-sm text-text-muted">{t("operations.status.errors.description")}</p>
      <Table
        caption={t("operations.status.errors.title")}
        columns={columns}
        rows={errors}
        rowKey={(row) => `${row.type}\u0000${row.code ?? ""}`}
        empty={<p className="py-3 text-sm text-text-muted">{t("operations.status.errors.empty")}</p>}
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
          <p className="-mt-4 text-sm text-text-muted">
            {t("operations.status.checkedAt", { time: format.relative(data.checkedAt) })}
          </p>
          <Tiles status={data} />
          {data.items.some((item) => item.status !== "ok") ? (
            <section aria-labelledby="status-attention" className="flex flex-col gap-2">
              <h2 id="status-attention" className="font-semibold">
                {t("operations.status.attention")}
              </h2>
              <ul className="flex flex-col gap-2">
                {[...data.items]
                  .filter((item) => item.status !== "ok")
                  .sort(
                    (left, right) => (left.status === "error" ? -1 : 0) - (right.status === "error" ? -1 : 0),
                  )
                  .map((item) => (
                    <ProblemCard key={item.id} item={item} />
                  ))}
              </ul>
            </section>
          ) : (
            <Notice variant="success" title={t("operations.status.summary.okTitle")}>
              {t("operations.status.summary.ok")}
            </Notice>
          )}
          <HealthyChecks items={data.items.filter((item) => item.status === "ok")} />
          <QueuesSection queues={data.queues} />
          {data.recentErrors.length > 0 ? <ErrorsSection errors={data.recentErrors} /> : null}
        </>
      ) : null}
    </SettingsPage>
  );
}
