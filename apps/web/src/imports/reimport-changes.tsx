import { slugify } from "@pagehall/editor-schema";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Icon,
  List,
  ListRow,
  Notice,
  Section,
  Select,
  Skeleton,
  Table,
  Tabs,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { ArrowRight, CheckCircle2, FolderTree, GitCompareArrows, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError, useFailureToast } from "../errors/failure.js";
import type { Formatter } from "../format/format.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { PageImpactSummary } from "../sharing/page-impact.js";
import { ImpactSummary } from "../spaces/access/impact.js";
import { pagePath } from "../spaces/space-queries.js";
import { type ImportView, importKeys, refreshImport } from "./imports-api.js";
import {
  applyChanges,
  applyDifference,
  CHANGE_TABS,
  type ChangeDecision,
  type ChangeEntry,
  type ChangeTab,
  changeSummaryQuery,
  changesQuery,
  type DifferenceImpact,
  decideChanges,
  previewDifference,
} from "./reimport-api.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/imports/$importId");

const CONFLICT_DECISIONS: readonly ChangeDecision[] = ["pagehall", "source", "both"];
const DELETE_DECISIONS: readonly ChangeDecision[] = ["trash", "keep"];
const UNDECIDED = "later";

function itemLink(entry: ChangeEntry) {
  if (!entry.item) return null;
  return pagePath(entry.item.spaceKey, entry.item.id, slugify(entry.item.title));
}

function decisionOptions(t: TFunction, decisions: readonly ChangeDecision[]) {
  return [
    ...decisions.map((decision) => ({
      value: decision,
      label: translateKey(t, `imports.reimport.decisions.${decision}`),
    })),
    { value: UNDECIDED, label: t("imports.reimport.decisions.later") },
  ];
}

function useDecide(entry: ImportView) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const failed = useFailureToast();
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const decide = async (ids: string[], decision: ChangeDecision | null) => {
    try {
      await decideChanges(entry.id, ids, decision);
      setSaved(new Set(ids));
      await refreshImport(queryClient, entry.id, entry.organizationId);
      return true;
    } catch (error) {
      failed(t("imports.reimport.decideFailed"), error, () => void decide(ids, decision));
      return false;
    }
  };
  return { decide, saved };
}

export function ReimportChanges({ entry }: { entry: ImportView }) {
  const { t } = useTranslation();
  const format = useFormat();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const failed = useFailureToast();
  const [applying, setApplying] = useState(false);
  const summary = useQuery(changeSummaryQuery(entry.id));
  const tab: ChangeTab = CHANGE_TABS.includes(search.tab as ChangeTab)
    ? (search.tab as ChangeTab)
    : "conflicts";
  const setTab = (next: string) => void navigate({ to: ".", search: { tab: next as ChangeTab } });
  const waiting = entry.state === "review";
  const done = entry.state === "accepted";

  const apply = async () => {
    setApplying(true);
    try {
      queryClient.setQueryData(importKeys.detail(entry.id), await applyChanges(entry.id));
      await refreshImport(queryClient, entry.id, entry.organizationId);
      toast({ title: t("imports.reimport.applying"), variant: "success" });
    } catch (error) {
      failed(t("imports.reimport.applyFailed"), error, () => void apply());
    } finally {
      setApplying(false);
    }
  };

  if (summary.isPending) return <Skeleton className="h-control-field w-full" />;
  if (summary.isError) {
    return (
      <LoadError what={t("imports.reimport.loadFailed")} error={summary.error} onRetry={summary.refetch} />
    );
  }
  const counts = summary.data.counts;
  const count = (name: ChangeTab) => summary.data.tabs.find((entry) => entry.tab === name)?.count ?? 0;
  const conflictsOpen = summary.data.tabs.find((entry) => entry.tab === "conflicts")?.open ?? 0;
  const deletionsOpen = summary.data.tabs.find((entry) => entry.tab === "deleted")?.open ?? 0;
  const updates = (counts.new ?? 0) + (counts.updated ?? 0) + (counts.labels ?? 0);
  return (
    <div className="flex flex-col gap-4">
      {done ? (
        <Notice variant="success" title={t("imports.reimport.doneTitle")}>
          {t("imports.reimport.done", { when: format.relative(entry.updatedAt) })}
        </Notice>
      ) : null}
      {entry.state === "superseded" ? (
        <Notice variant="info" title={t("imports.reimport.supersededTitle")}>
          {t("imports.reimport.superseded")}
        </Notice>
      ) : null}
      {summary.data.hidden > 0 ? (
        <Notice variant="info" title={t("imports.reimport.hiddenTitle")}>
          {t("imports.reimport.hidden", { count: summary.data.hidden })}
        </Notice>
      ) : null}
      <Tabs
        value={tab}
        onValueChange={setTab}
        label={t("imports.reimport.tabsLabel")}
        tabs={[
          { value: "conflicts", label: t("imports.reimport.tabs.conflicts"), count: count("conflicts") },
          { value: "updates", label: t("imports.reimport.tabs.updates"), count: updates },
          { value: "deleted", label: t("imports.reimport.tabs.deleted"), count: count("deleted") },
          { value: "moved", label: t("imports.reimport.tabs.moved"), count: count("moved") },
          {
            value: "permissions",
            label: t("imports.reimport.tabs.permissions"),
            count: count("permissions"),
          },
        ]}
      >
        {tab === "conflicts" ? <ConflictsTab entry={entry} editable={waiting} /> : null}
        {tab === "updates" ? <UpdatesTab counts={counts} format={format} /> : null}
        {tab === "deleted" ? <DeletedTab entry={entry} editable={waiting} /> : null}
        {tab === "moved" ? <MovedTab entry={entry} /> : null}
        {tab === "permissions" ? <PermissionsTab entry={entry} /> : null}
      </Tabs>
      {waiting ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center">
          <span className="min-w-0 text-sm text-text-muted sm:flex-1">
            {conflictsOpen + deletionsOpen > 0
              ? t("imports.reimport.waiting", { conflicts: conflictsOpen, deletions: deletionsOpen })
              : t("imports.reimport.allDecided")}
          </span>
          <Button variant="primary" loading={applying} onClick={() => void apply()}>
            {t("imports.reimport.apply")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SelectionBar({
  count,
  decisions,
  limited = false,
  onDecide,
}: {
  count: number;
  decisions: readonly ChangeDecision[];
  limited?: boolean;
  onDecide: (decision: ChangeDecision | null) => void;
}) {
  const { t } = useTranslation();
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t("imports.reimport.bulkLabel")}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface-sunken p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="me-auto font-medium">{t("imports.reimport.selected", { count })}</span>
        {decisions.map((decision) => (
          <Button key={decision} variant="secondary" onClick={() => onDecide(decision)}>
            {translateKey(t, `imports.reimport.decisions.${decision}`)}
          </Button>
        ))}
        <Button variant="outline" onClick={() => onDecide(null)}>
          {t("imports.reimport.decisions.later")}
        </Button>
      </div>
      {limited ? <p className="text-sm text-text-muted">{t("imports.reimport.selectionLimited")}</p> : null}
    </div>
  );
}

function DecisionCell({
  entry,
  editable,
  saved,
  onDecide,
}: {
  entry: ChangeEntry;
  editable: boolean;
  saved: boolean;
  onDecide: (decision: ChangeDecision | null) => void;
}) {
  const { t } = useTranslation();
  if (entry.appliedAt) {
    return (
      <span className="inline-flex items-center gap-1 text-sm text-success">
        <CheckCircle2 aria-hidden="true" className="size-icon-sm" />
        {entry.decision
          ? translateKey(t, `imports.reimport.decisions.${entry.decision}`)
          : t("imports.reimport.applied")}
      </span>
    );
  }
  if (!editable) {
    return (
      <span className="text-sm text-text-muted">
        {entry.decision
          ? translateKey(t, `imports.reimport.decisions.${entry.decision}`)
          : t("imports.reimport.undecided")}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Select
        value={entry.decision ?? undefined}
        onValueChange={(value) => onDecide(value === UNDECIDED ? null : (value as ChangeDecision))}
        options={decisionOptions(t, entry.decisions)}
        placeholder={t("imports.reimport.decide")}
        aria-label={t("imports.reimport.decisionFor", { title: entry.title ?? "" })}
      />
      {saved ? (
        <span role="status" className="text-sm text-success">
          {t("imports.reimport.saved")}
        </span>
      ) : null}
    </div>
  );
}

function useChanges(entry: ImportView, tab: ChangeTab) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const query = useQuery(changesQuery(entry.id, tab, cursor));
  const pagination = {
    hasPrevious: cursors.length > 1,
    hasNext: Boolean(query.data?.nextCursor),
    onPrevious: () => setCursors((list) => list.slice(0, -1)),
    onNext: () => setCursors((list) => [...list, query.data?.nextCursor ?? null]),
  };
  return { query, pagination };
}

function ConflictsTab({ entry, editable }: { entry: ImportView; editable: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { query, pagination } = useChanges(entry, "conflicts");
  const { decide, saved } = useDecide(entry);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  if (query.isError) {
    return <LoadError what={t("imports.reimport.loadFailed")} error={query.error} onRetry={query.refetch} />;
  }
  const rows = query.data?.items ?? [];
  const open = rows.filter((row) => !row.appliedAt);
  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const all = open.length > 0 && open.every((row) => selected.has(row.id));
  const chosen = open.filter((row) => selected.has(row.id));
  const offered = CONFLICT_DECISIONS.filter((decision) =>
    chosen.every((row) => row.decisions.includes(decision)),
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t("imports.reimport.conflictsHint")}</p>
      {editable ? (
        <SelectionBar
          count={selected.size}
          decisions={offered}
          limited={offered.length < CONFLICT_DECISIONS.length}
          onDecide={(decision) =>
            void decide([...selected], decision).then((ok) => {
              if (ok) setSelected(new Set());
            })
          }
        />
      ) : null}
      <Table
        caption={t("imports.reimport.tabs.conflicts")}
        loading={query.isPending}
        rows={rows}
        rowKey={(row) => row.id}
        pagination={pagination}
        empty={
          <EmptyState
            icon={GitCompareArrows}
            title={t("imports.reimport.noConflicts")}
            description={t("imports.reimport.noConflictsDescription")}
          />
        }
        columns={[
          ...(editable
            ? [
                {
                  key: "select",
                  header: (
                    <Checkbox
                      checked={all}
                      onCheckedChange={(on) =>
                        setSelected(on ? new Set(open.map((row) => row.id)) : new Set())
                      }
                      aria-label={t("imports.reimport.selectAll")}
                    />
                  ),
                  cell: (row: ChangeEntry) =>
                    row.appliedAt ? null : (
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={(on) => toggle(row.id, on)}
                        aria-label={t("imports.reimport.select", { title: row.title ?? "" })}
                      />
                    ),
                },
              ]
            : []),
          {
            key: "page",
            header: t("imports.reimport.columns.page"),
            cell: (row: ChangeEntry) => <ChangeTitle entry={row} />,
          },
          {
            key: "here",
            header: t("imports.reimport.columns.changedHere"),
            hideBelow: "md" as const,
            cell: (row: ChangeEntry) =>
              row.changedHere
                ? t("imports.reimport.changedBy", {
                    name: row.changedHere.by?.name ?? t("imports.reimport.someone"),
                    when: format.relative(row.changedHere.at),
                  })
                : "",
          },
          {
            key: "source",
            header: t("imports.reimport.columns.changedAtSource"),
            hideBelow: "md" as const,
            cell: (row: ChangeEntry) => (row.changedAtSource ? format.relative(row.changedAtSource) : ""),
          },
          {
            key: "compare",
            header: t("imports.reimport.columns.compare"),
            cell: (row: ChangeEntry) =>
              row.appliedAt || entry.state !== "review" ? null : (
                <Link
                  to="/settings/organizations/$organizationId/imports/$importId/changes/$changeId/compare"
                  params={{ organizationId: entry.organizationId, importId: entry.id, changeId: row.id }}
                  aria-label={t("imports.reimport.compareTitle", { title: row.title ?? "" })}
                  className="inline-flex h-control-md items-center gap-2 rounded-md border border-control-border px-3 font-medium whitespace-nowrap hover:bg-hover focus-visible:focus-ring"
                >
                  <Icon icon={GitCompareArrows} size="sm" />
                  {t("imports.reimport.compareAction")}
                </Link>
              ),
          },
          {
            key: "decision",
            header: t("imports.reimport.columns.decision"),
            cell: (row: ChangeEntry) => (
              <DecisionCell
                entry={row}
                editable={editable}
                saved={saved.has(row.id)}
                onDecide={(decision) => void decide([row.id], decision)}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function ChangeTitle({ entry }: { entry: ChangeEntry }) {
  const { t } = useTranslation();
  const href = itemLink(entry);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {href ? (
        <Link
          to={href}
          className="truncate font-medium text-accent underline-offset-2 hover:underline"
          title={entry.title ?? ""}
        >
          {entry.title}
        </Link>
      ) : (
        <span className="truncate font-medium" title={entry.title ?? ""}>
          {entry.title}
        </span>
      )}
      {entry.kind === "template" ? (
        <span className="text-sm text-text-muted">{t("imports.reimport.template")}</span>
      ) : null}
      {entry.reason === "editing" || entry.editing ? (
        <span>
          <Badge variant="warning">{t("imports.reimport.editing")}</Badge>
        </span>
      ) : null}
      {entry.held ? (
        <span className="text-sm text-text-muted">
          {entry.heldFor
            ? t("imports.reimport.restrictedBy", { title: entry.heldFor.title })
            : t("imports.reimport.restricted")}
          {entry.heldFor ? (
            <>
              {" "}
              <Link
                from="/settings/organizations/$organizationId/imports/$importId"
                to="."
                search={{ tab: "permissions" }}
                className="text-accent underline underline-offset-2 hover:no-underline focus-visible:focus-ring"
              >
                {t("imports.reimport.showDifference")}
              </Link>
            </>
          ) : null}
        </span>
      ) : null}
      {entry.sourceTitle && entry.sourceTitle !== entry.title ? (
        <span className="text-sm text-text-muted">
          {t("imports.reimport.sourceTitle", { title: entry.sourceTitle })}
        </span>
      ) : null}
    </div>
  );
}

function UpdatesTab({ counts, format }: { counts: Readonly<Record<string, number>>; format: Formatter }) {
  const { t } = useTranslation();
  const rows = (
    [
      ["new", "newPages"],
      ["updated", "updatedPages"],
      ["unchanged", "unchanged"],
      ["labels", "labels"],
      ["newComments", "newComments"],
      ["newAttachmentVersions", "newAttachments"],
      ["newTemplates", "newTemplates"],
      ["updatedTemplates", "updatedTemplates"],
      ["deletedHere", "deletedHere"],
      ["restricted", "restricted"],
    ] as const
  ).filter(
    ([name]) => (counts[name] ?? 0) > 0 || name === "new" || name === "updated" || name === "unchanged",
  );
  return (
    <List label={t("imports.reimport.tabs.updates")}>
      {rows.map(([name, key]) => (
        <ListRow
          key={name}
          icon={CheckCircle2}
          title={t(`imports.reimport.updates.${key}`, {
            count: counts[name] ?? 0,
            formatted: format.number(counts[name] ?? 0),
          })}
          description={t(`imports.reimport.updates.${key}Description`)}
        />
      ))}
    </List>
  );
}

function DeletedTab({ entry, editable }: { entry: ImportView; editable: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { query, pagination } = useChanges(entry, "deleted");
  const { decide, saved } = useDecide(entry);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  if (query.isError) {
    return <LoadError what={t("imports.reimport.loadFailed")} error={query.error} onRetry={query.refetch} />;
  }
  const rows = query.data?.items ?? [];
  const pages = rows.filter((row) => row.change === "deleted");
  const gone = rows.filter((row) => row.change === "gone");
  const open = pages.filter((row) => !row.appliedAt);
  const all = open.length > 0 && open.every((row) => selected.has(row.id));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{t("imports.reimport.deletedHint")}</p>
      {editable ? (
        <SelectionBar
          count={selected.size}
          decisions={DELETE_DECISIONS}
          onDecide={(decision) =>
            void decide([...selected], decision).then((ok) => {
              if (ok) setSelected(new Set());
            })
          }
        />
      ) : null}
      <Table
        caption={t("imports.reimport.tabs.deleted")}
        loading={query.isPending}
        rows={pages}
        rowKey={(row) => row.id}
        pagination={pagination}
        empty={
          <EmptyState
            icon={Trash2}
            title={t("imports.reimport.noDeleted")}
            description={t("imports.reimport.noDeletedDescription")}
          />
        }
        columns={[
          ...(editable
            ? [
                {
                  key: "select",
                  header: (
                    <Checkbox
                      checked={all}
                      onCheckedChange={(on) =>
                        setSelected(on ? new Set(open.map((row) => row.id)) : new Set())
                      }
                      aria-label={t("imports.reimport.selectAll")}
                    />
                  ),
                  cell: (row: ChangeEntry) =>
                    row.appliedAt ? null : (
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={(on) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (on) next.add(row.id);
                            else next.delete(row.id);
                            return next;
                          })
                        }
                        aria-label={t("imports.reimport.select", { title: row.title ?? "" })}
                      />
                    ),
                },
              ]
            : []),
          {
            key: "page",
            header: t("imports.reimport.columns.page"),
            cell: (row: ChangeEntry) => <ChangeTitle entry={row} />,
          },
          {
            key: "here",
            header: t("imports.reimport.columns.lastChange"),
            hideBelow: "md" as const,
            cell: (row: ChangeEntry) =>
              row.changedHere
                ? t("imports.reimport.changedBy", {
                    name: row.changedHere.by?.name ?? t("imports.reimport.someone"),
                    when: format.relative(row.changedHere.at),
                  })
                : t("imports.reimport.notChangedHere"),
          },
          {
            key: "decision",
            header: t("imports.reimport.columns.decision"),
            cell: (row: ChangeEntry) => (
              <DecisionCell
                entry={row}
                editable={editable}
                saved={saved.has(row.id)}
                onDecide={(decision) => void decide([row.id], decision)}
              />
            ),
          },
        ]}
      />
      {gone.length > 0 ? (
        <Section title={t("imports.reimport.goneTitle")}>
          <p className="text-sm text-text-muted">{t("imports.reimport.goneDescription")}</p>
          <List label={t("imports.reimport.goneTitle")}>
            {gone.map((row) => (
              <ListRow
                key={row.id}
                title={
                  row.kind === "comment"
                    ? t("imports.reimport.goneComment", { title: row.title ?? "" })
                    : t("imports.reimport.goneAttachment", { name: row.title ?? "" })
                }
              />
            ))}
          </List>
        </Section>
      ) : null}
    </div>
  );
}

function MovedTab({ entry }: { entry: ImportView }) {
  const { t } = useTranslation();
  const { query, pagination } = useChanges(entry, "moved");
  if (query.isError) {
    return <LoadError what={t("imports.reimport.loadFailed")} error={query.error} onRetry={query.refetch} />;
  }
  return (
    <Table
      caption={t("imports.reimport.tabs.moved")}
      loading={query.isPending}
      rows={query.data?.items ?? []}
      rowKey={(row) => row.id}
      pagination={pagination}
      empty={
        <EmptyState
          icon={FolderTree}
          title={t("imports.reimport.noMoves")}
          description={t("imports.reimport.noMovesDescription")}
        />
      }
      columns={[
        {
          key: "page",
          header: t("imports.reimport.columns.page"),
          cell: (row) => <ChangeTitle entry={row} />,
        },
        {
          key: "move",
          header: t("imports.reimport.columns.move"),
          cell: (row) => (
            <span className="inline-flex flex-wrap items-center gap-1">
              <span>{row.from?.title ?? t("imports.reimport.topLevel")}</span>
              <ArrowRight aria-label={t("imports.reimport.movedTo")} className="size-icon-sm" />
              <span>{row.to?.title ?? t("imports.reimport.topLevel")}</span>
            </span>
          ),
        },
        {
          key: "outcome",
          header: t("imports.reimport.columns.outcome"),
          cell: (row) =>
            row.change === "movedHere" ? t("imports.reimport.stays") : t("imports.reimport.follows"),
        },
      ]}
    />
  );
}

function permissionText(t: TFunction, row: ChangeEntry): string {
  const permission = row.permission;
  if (!permission) return "";
  const holder =
    permission.holder?.kind === "organizationMembers"
      ? t("imports.reimport.permissions.members")
      : (permission.holder?.name ?? permission.holder?.sourceName ?? "");
  const role = (value: string | null) =>
    value
      ? translateKey(t, `spaces.roles.${value}`, { defaultValue: value })
      : t("imports.reimport.permissions.none");
  const restriction = permission.restriction === "edit" ? "edit" : "view";
  switch (permission.action) {
    case "grant":
    case "change":
    case "remove":
      return t("imports.reimport.permissions.space", {
        holder,
        role: role(permission.role),
        current: role(permission.currentRole),
      });
    case "restrict":
      return t(`imports.reimport.permissions.restrict.${restriction}`);
    case "unrestrict":
      return t(`imports.reimport.permissions.unrestrict.${restriction}`);
    case "listHolder":
      return t(`imports.reimport.permissions.list.${restriction}`, { holder });
    default:
      return t(`imports.reimport.permissions.unlist.${restriction}`, { holder });
  }
}

function PermissionsTab({ entry }: { entry: ImportView }) {
  const { t } = useTranslation();
  const failed = useFailureToast();
  const { query, pagination } = useChanges(entry, "permissions");
  const [loading, setLoading] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ change: ChangeEntry; impact: DifferenceImpact } | null>(null);
  const review = async (change: ChangeEntry) => {
    setLoading(change.id);
    try {
      setChosen({ change, impact: await previewDifference(entry.id, change.id) });
    } catch (error) {
      failed(t("imports.reimport.permissions.impactFailed"), error, () => void review(change));
    } finally {
      setLoading(null);
    }
  };
  if (query.isError) {
    return <LoadError what={t("imports.reimport.loadFailed")} error={query.error} onRetry={query.refetch} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">{t("imports.reimport.permissionsHint")}</p>
      <Table
        caption={t("imports.reimport.tabs.permissions")}
        loading={query.isPending}
        rows={query.data?.items ?? []}
        rowKey={(row) => row.id}
        pagination={pagination}
        empty={
          <EmptyState
            icon={CheckCircle2}
            title={t("imports.reimport.noPermissions")}
            description={t("imports.reimport.noPermissionsDescription")}
          />
        }
        columns={[
          {
            key: "where",
            header: t("imports.reimport.columns.where"),
            cell: (row) =>
              row.item ? (
                <ChangeTitle entry={row} />
              ) : (
                <span className="font-medium">{t("imports.reimport.wholeSpace")}</span>
              ),
          },
          {
            key: "difference",
            header: t("imports.reimport.columns.difference"),
            cell: (row) => permissionText(t, row),
          },
          {
            key: "action",
            header: t("imports.reimport.columns.action"),
            cell: (row) =>
              row.appliedAt ? (
                <span className="inline-flex items-center gap-1 text-sm text-success">
                  <CheckCircle2 aria-hidden="true" className="size-icon-sm" />
                  {t("imports.reimport.applied")}
                </span>
              ) : row.permission?.applicable ? (
                <Button variant="secondary" loading={loading === row.id} onClick={() => void review(row)}>
                  {t("imports.reimport.permissions.apply")}
                </Button>
              ) : (
                <span className="text-sm text-text-muted">
                  {t("imports.reimport.permissions.notInPagehall")}
                </span>
              ),
          },
        ]}
      />
      {chosen ? (
        <DifferenceDialog
          entry={entry}
          change={chosen.change}
          impact={chosen.impact}
          onClose={() => setChosen(null)}
        />
      ) : null}
    </div>
  );
}

function DifferenceDialog({
  entry,
  change,
  impact,
  onClose,
}: {
  entry: ImportView;
  change: ChangeEntry;
  impact: DifferenceImpact;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const failed = useFailureToast();
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("imports.reimport.permissions.confirmTitle")}
      description={permissionText(t, change)}
      confirmLabel={t("imports.reimport.permissions.confirm")}
      cancelLabel={t("imports.reimport.permissions.cancel")}
      onConfirm={async () => {
        try {
          await applyDifference(entry.id, change.id);
          await refreshImport(queryClient, entry.id, entry.organizationId);
          toast({ title: t("imports.reimport.permissions.applied"), variant: "success" });
          onClose();
        } catch (error) {
          failed(t("imports.reimport.permissions.failed"), error);
          throw error;
        }
      }}
    >
      {impact.space ? <ImpactSummary impact={impact.space} /> : null}
      {impact.page ? <PageImpactSummary impact={impact.page} /> : null}
    </ConfirmDialog>
  );
}
