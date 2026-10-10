import {
  Badge,
  type BadgeVariant,
  Button,
  Combobox,
  type ComboboxItem,
  type ComboboxLoader,
  ConfirmDialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  Section,
  Skeleton,
  Table,
  TableToolbar,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { CheckCircle2, ShieldCheck, Upload, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { memberLoader } from "../components/pickers.js";
import { LoadError, useFailureToast } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import {
  groupsQuery,
  type ImportGroup,
  type ImportView,
  mapGroup,
  mapPeople,
  type PermissionEntry,
  type Placeholder,
  peopleQuery,
  permissionsQuery,
  refreshImport,
  uploadUserList,
} from "./imports-api.js";
import { UserListField } from "./user-list-field.js";

const WIDE = "(min-width: 48rem)";

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const update = () => setWide(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
}

interface Choice {
  readonly id: string;
  readonly name: string;
}

function personName(t: TFunction, person: Placeholder): string {
  return person.named ? person.name : t("imports.people.unknown");
}

function roleText(t: TFunction, role: string | null): string {
  return role ? translateKey(t, `spaces.roles.${role}`, { defaultValue: role }) : "";
}

export function PeopleTab({ organizationId, entry }: { organizationId: string; entry: ImportView }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const failed = useFailureToast();
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [confirming, setConfirming] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const cursor = cursors.at(-1) ?? null;
  const page = useQuery(peopleQuery(entry.id, search.trim(), cursor));
  const wide = useWide();
  const manage = entry.canResolve;
  const chosen = Object.entries(choices);
  const people = page.data?.items ?? [];
  const known = new Map(people.map((person) => [person.id, person]));
  const withAccess = chosen
    .map(([id]) => known.get(id))
    .filter(
      (person): person is Placeholder =>
        !!person && (person.restrictedPages > 0 || person.spaceRole !== null),
    );

  const choose = (person: Placeholder, choice: Choice | null) =>
    setChoices((current) => {
      const next = { ...current };
      if (choice) next[person.id] = choice;
      else delete next[person.id];
      return next;
    });

  const refresh = async () => {
    await refreshImport(queryClient, entry.id, organizationId);
  };

  const accountCell = (person: Placeholder) =>
    person.mappedTo ? (
      <Badge variant="success" icon={CheckCircle2}>
        {t("imports.people.mappedTo", { name: person.mappedTo.name })}
      </Badge>
    ) : manage ? (
      <AccountChoice
        organizationId={organizationId}
        person={person}
        value={choices[person.id] ?? null}
        onChange={(choice) => choose(person, choice)}
      />
    ) : (
      <span className="text-sm text-text-muted">{t("imports.people.placeholder")}</span>
    );

  const columns = [
    {
      key: "person",
      header: t("imports.people.inConfluence"),
      cell: (person: Placeholder) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium" title={personName(t, person)}>
            {personName(t, person)}
          </span>
          <span className="truncate font-mono text-sm text-text-muted" title={person.externalId}>
            {person.externalId}
          </span>
          <span className="truncate text-sm text-text-muted" title={person.email ?? undefined}>
            {person.email ?? t("imports.people.noEmail")}
          </span>
          {wide ? null : <div className="mt-2">{accountCell(person)}</div>}
        </div>
      ),
    },
    {
      key: "content",
      header: t("imports.people.content"),
      hideBelow: "md" as const,
      cell: (person: Placeholder) => (
        <div className="flex flex-col text-sm">
          <span>{t("imports.people.owns", { items: person.items, comments: person.comments })}</span>
          {person.spaceRole ? (
            <span className="text-text-muted">
              {t("imports.people.spaceRole", { role: roleText(t, person.spaceRole) })}
            </span>
          ) : null}
          {person.restrictedPages > 0 ? (
            <span className="text-text-muted">
              {t("imports.people.restricted", { count: person.restrictedPages })}
            </span>
          ) : null}
        </div>
      ),
    },
    ...(wide
      ? [
          {
            key: "account",
            header: t("imports.people.account"),
            cell: (person: Placeholder) => accountCell(person),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <TableToolbar
        search={{
          value: search,
          onChange: (value) => {
            setSearch(value);
            setCursors([]);
          },
          label: t("imports.people.filter"),
          placeholder: t("imports.people.filterPlaceholder"),
        }}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {page.data ? (
          <span className="text-sm text-text-muted tabular-nums">
            {t("imports.people.mappedCount", { mapped: page.data.mapped, total: page.data.total })}
          </span>
        ) : null}
        {manage ? (
          <Button
            variant="secondary"
            icon={Upload}
            aria-expanded={listOpen}
            onClick={() => setListOpen(!listOpen)}
          >
            {t("imports.people.uploadList")}
          </Button>
        ) : null}
      </div>
      {listOpen ? (
        <Section title={t("imports.people.uploadList")}>
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-text-muted">{t("imports.people.uploadListHint")}</p>
            <UserListField
              result={null}
              onRead={async (text) => {
                const result = await uploadUserList(entry.id, text);
                await refresh();
                setListOpen(false);
                toast({
                  title: t("imports.people.listApplied", {
                    matched: result.matched,
                    named: result.named,
                    remaining: result.remaining,
                  }),
                  variant: "success",
                });
              }}
            />
          </div>
        </Section>
      ) : null}
      {page.isPending ? (
        <Skeleton className="h-control-field w-full" />
      ) : page.isError ? (
        <LoadError what={t("imports.people.loadFailed")} error={page.error} onRetry={page.refetch} />
      ) : page.data.total === 0 ? (
        <EmptyState
          icon={Users}
          title={t("imports.people.none")}
          description={t("imports.people.noneDescription")}
        />
      ) : people.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("imports.people.noMatch")}
          description={t("imports.people.noMatchDescription")}
          action={
            <Button variant="secondary" onClick={() => setSearch("")}>
              {t("imports.people.clearFilter")}
            </Button>
          }
        />
      ) : (
        <Table
          caption={t("imports.people.caption")}
          columns={columns}
          rows={people}
          rowKey={(person) => person.id}
          pagination={{
            hasPrevious: cursors.length > 0,
            hasNext: page.data.nextCursor !== null,
            onPrevious: () => setCursors((current) => current.slice(0, -1)),
            onNext: () => {
              const next = page.data.nextCursor;
              if (next) setCursors((current) => [...current, next]);
            },
          }}
        />
      )}
      {manage && chosen.length > 0 ? (
        <section
          aria-label={t("imports.people.chosenRegion")}
          className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface-raised p-3 shadow-md"
        >
          <span className="min-w-0 flex-1 font-medium">
            {t("imports.people.chosen", { count: chosen.length })}
          </span>
          <Button variant="secondary" onClick={() => setChoices({})}>
            {t("imports.people.clearChoices")}
          </Button>
          <Button variant="primary" onClick={() => setConfirming(true)}>
            {t("imports.people.map", { count: chosen.length })}
          </Button>
        </section>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("imports.people.confirmTitle", { count: chosen.length })}
        description={t("imports.people.confirmDescription", { count: chosen.length })}
        confirmLabel={t("imports.people.map", { count: chosen.length })}
        cancelLabel={t("imports.people.keepPlaceholders")}
        onConfirm={async () => {
          try {
            const result = await mapPeople(
              entry.id,
              chosen.map(([placeholderId, choice]) => ({ placeholderId, accountId: choice.id })),
            );
            setChoices({});
            await refresh();
            toast({ title: t("imports.people.mapped", { count: result.mapped }), variant: "success" });
          } catch (error) {
            failed(t("imports.people.mapFailed"), error);
            throw error;
          }
        }}
      >
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
          {chosen.map(([id, choice]) => {
            const person = known.get(id);
            return (
              <li key={id}>
                {t("imports.people.confirmRow", {
                  from: person ? personName(t, person) : id,
                  to: choice.name,
                })}
              </li>
            );
          })}
        </ul>
        {withAccess.length > 0 ? (
          <p className="text-sm">
            {t("imports.people.confirmAccess", {
              count: withAccess.length,
              names: withAccess.map((person) => choices[person.id]?.name ?? "").join(", "),
            })}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function AccountChoice({
  organizationId,
  person,
  value,
  onChange,
}: {
  organizationId: string;
  person: Placeholder;
  value: Choice | null;
  onChange: (choice: Choice | null) => void;
}) {
  const { t } = useTranslation();
  const label = t("imports.people.accountFor", { name: personName(t, person) });
  const selected: ComboboxItem | null = value ? { value: value.id, label: value.name } : null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div>
        <Field label={<span className="sr-only">{label}</span>}>
          <Combobox
            load={memberLoader(organizationId)}
            value={value?.id ?? null}
            selectedItem={selected}
            placeholder={t("imports.people.keepPlaceholder")}
            onValueChange={(id, item) => onChange(id && item ? { id, name: item.label } : null)}
          />
        </Field>
      </div>
      {!value && person.candidates.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">{t("imports.people.similar")}</span>
          {person.candidates.map((candidate) => (
            <Button key={candidate.id} variant="secondary" size="sm" onClick={() => onChange(candidate)}>
              {t("imports.people.useCandidate", { name: candidate.name })}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const STATUS_BADGES: Record<string, BadgeVariant> = {
  mapped: "success",
  check: "warning",
  waiting: "warning",
  missing: "danger",
  notTaken: "neutral",
};

function groupLoader(organizationId: string): ComboboxLoader {
  return async (search, cursor) => {
    const page = await request(() =>
      api.GET("/api/v1/organizations/{organizationId}/groups", {
        params: {
          path: { organizationId },
          query: { limit: 20, ...(search.trim() ? { q: search.trim() } : {}), ...(cursor ? { cursor } : {}) },
        },
      }),
    );
    return {
      items: page.items.map((group) => ({
        value: group.id,
        label: group.name,
        description: group.description ?? "",
      })),
      nextCursor: page.nextCursor,
    };
  };
}

export function PermissionsTab({ organizationId, entry }: { organizationId: string; entry: ImportView }) {
  const { t } = useTranslation();
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1) ?? null;
  const groups = useQuery(groupsQuery(entry.id));
  const page = useQuery(permissionsQuery(entry.id, cursor));

  const holder = (row: PermissionEntry) => {
    const name =
      row.holder.kind === "organizationMembers"
        ? t("imports.permissions.allUsers")
        : row.holder.kind === "anonymous"
          ? t("imports.permissions.anonymous")
          : row.holder.kind === "group"
            ? t("imports.permissions.group", { name: row.holder.sourceName ?? "" })
            : (row.holder.name ?? t("imports.people.unknown"));
    return row.scope === "page"
      ? t(`imports.permissions.restriction.${row.restriction === "edit" ? "edit" : "view"}`, {
          holder: name,
          title: row.item?.title ?? t("imports.report.restrictedPage"),
        })
      : name;
  };

  const target = (row: PermissionEntry) => {
    if (row.status === "notTaken") return t("imports.permissions.notTaken");
    const who =
      row.holder.kind === "organizationMembers"
        ? t("imports.permissions.allMembers")
        : row.holder.kind === "group"
          ? (row.holder.name ?? row.holder.sourceName ?? "")
          : (row.holder.name ?? "");
    return row.scope === "page"
      ? t(`imports.permissions.pageRole.${row.role === "editor" ? "editor" : "reader"}`, { who })
      : t("imports.permissions.spaceRole", { who, role: roleText(t, row.role) });
  };

  return (
    <div className="flex flex-col gap-4">
      {groups.isPending ? (
        <Skeleton className="h-control-field w-full" />
      ) : groups.isError ? (
        <LoadError
          what={t("imports.permissions.groupsFailed")}
          error={groups.error}
          onRetry={groups.refetch}
        />
      ) : groups.data.length > 0 ? (
        <Section title={t("imports.permissions.groups")}>
          <ul className="flex flex-col divide-y divide-border">
            {groups.data.map((group) => (
              <GroupRow key={group.key} organizationId={organizationId} entry={entry} group={group} />
            ))}
          </ul>
        </Section>
      ) : null}
      {page.isPending ? (
        <Skeleton className="h-control-field w-full" />
      ) : page.isError ? (
        <LoadError what={t("imports.permissions.loadFailed")} error={page.error} onRetry={page.refetch} />
      ) : page.data.items.length === 0 && cursors.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title={t("imports.permissions.none")}
          description={t("imports.permissions.noneDescription")}
        />
      ) : (
        <Table
          caption={t("imports.permissions.caption")}
          rows={page.data.items}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "source",
              header: t("imports.permissions.inConfluence"),
              cell: (row) => (
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{holder(row)}</span>
                  {row.permissions.length > 0 ? (
                    <span className="text-sm break-words text-text-muted">{row.permissions.join(", ")}</span>
                  ) : null}
                </div>
              ),
            },
            {
              key: "target",
              header: t("imports.permissions.inPagehall"),
              hideBelow: "md",
              cell: (row) => <span>{target(row)}</span>,
            },
            {
              key: "status",
              header: t("imports.permissions.status"),
              cell: (row) => (
                <div className="flex flex-col items-start gap-1">
                  <Badge variant={STATUS_BADGES[row.status] ?? "neutral"}>
                    {translateKey(t, `imports.permissions.statuses.${row.status}`, {
                      defaultValue: row.status,
                    })}
                  </Badge>
                  {row.code ? (
                    <span className="text-sm text-text-muted">
                      {translateKey(t, `imports.permissions.codes.${row.code}`, { defaultValue: "" })}
                    </span>
                  ) : null}
                </div>
              ),
            },
          ]}
          pagination={{
            hasPrevious: cursors.length > 0,
            hasNext: page.data.nextCursor !== null,
            onPrevious: () => setCursors((current) => current.slice(0, -1)),
            onNext: () => {
              const next = page.data.nextCursor;
              if (next) setCursors((current) => [...current, next]);
            },
          }}
        />
      )}
    </div>
  );
}

function GroupRow({
  organizationId,
  entry,
  group,
}: {
  organizationId: string;
  entry: ImportView;
  group: ImportGroup;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const failed = useFailureToast();
  const [chosen, setChosen] = useState<Choice | null>(null);
  const [missing, setMissing] = useState(false);
  const [confirm, setConfirm] = useState<"existing" | "create" | null>(null);
  const usage = [
    group.spaceRole ? t("imports.people.spaceRole", { role: roleText(t, group.spaceRole) }) : null,
    group.restrictedPages > 0 ? t("imports.people.restricted", { count: group.restrictedPages }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const apply = async () => {
    try {
      await mapGroup(
        entry.id,
        group.key,
        confirm === "create" ? { create: true } : { groupId: chosen?.id ?? "" },
      );
      await refreshImport(queryClient, entry.id, organizationId);
      toast({ title: t("imports.permissions.groupMapped", { name: group.name }), variant: "success" });
      setChosen(null);
    } catch (error) {
      failed(t("imports.permissions.groupFailed", { name: group.name }), error);
      throw error;
    }
  };
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-field flex-col">
        <span className="truncate font-medium" title={group.name}>
          {t("imports.permissions.group", { name: group.name })}
        </span>
        {usage ? <span className="text-sm text-text-muted">{usage}</span> : null}
      </div>
      {group.group ? (
        <Badge variant="success" icon={CheckCircle2}>
          {t("imports.people.mappedTo", { name: group.group.name })}
        </Badge>
      ) : entry.canResolve ? (
        <div className="flex min-w-0 flex-1 basis-field flex-col gap-2">
          <Field
            label={t("imports.permissions.chooseGroup", { name: group.name })}
            {...(missing ? { error: t("imports.permissions.chooseGroupFirst") } : {})}
          >
            <Combobox
              load={groupLoader(organizationId)}
              value={chosen?.id ?? null}
              selectedItem={chosen ? { value: chosen.id, label: chosen.name } : null}
              placeholder={t("imports.permissions.searchGroup")}
              invalid={missing}
              onValueChange={(id, item) => {
                setChosen(id && item ? { id, name: item.label } : null);
                setMissing(false);
              }}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                if (chosen) {
                  setConfirm("existing");
                  return;
                }
                setMissing(true);
                focusFirstInvalidSoon();
              }}
            >
              {t("imports.permissions.mapGroup")}
            </Button>
            <Button variant="secondary" onClick={() => setConfirm("create")}>
              {t("imports.permissions.createGroup", { name: group.name })}
            </Button>
          </div>
        </div>
      ) : (
        <Badge variant="danger">{t("imports.permissions.statuses.missing")}</Badge>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm === "create"
            ? t("imports.permissions.createTitle", { name: group.name })
            : t("imports.permissions.mapTitle", { from: group.name, to: chosen?.name ?? "" })
        }
        description={t("imports.permissions.mapDescription", {
          role: group.spaceRole ? roleText(t, group.spaceRole) : t("imports.permissions.noRole"),
          count: group.restrictedPages,
        })}
        confirmLabel={
          confirm === "create"
            ? t("imports.permissions.createGroup", { name: group.name })
            : t("imports.permissions.mapGroup")
        }
        cancelLabel={t("imports.permissions.keepUnmapped")}
        onConfirm={apply}
      />
    </li>
  );
}
