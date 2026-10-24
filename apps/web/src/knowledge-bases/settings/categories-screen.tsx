import { closestCenter, DndContext, type DragEndEvent, type DragMoveEvent, DragOverlay } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  Button,
  Combobox,
  classNames,
  EmptyState,
  Field,
  IconButton,
  Input,
  Menu,
  type MenuItem,
  type SaveState,
  SaveStatus,
  Section,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  FolderTree,
  IndentDecrease,
  IndentIncrease,
  type LucideIcon,
  MoreHorizontal,
  RotateCcw,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useSortableAccessibility, useSortableItem, useSortableSensors } from "../../meetings/sortable.js";
import { Panel } from "../../spaces/settings/panel.js";
import { SpaceSettingsPage } from "../../spaces/settings/space-settings-page.js";
import { useSpace } from "../../spaces/space-context.js";
import { MoveConfirmDialog, moveImpactOf, type PendingMove } from "../../spaces/tree/move-confirmation.js";
import { ICON_NAMES, NamedIcon } from "../icons.js";
import { type Category, categoriesQuery, knowledgeBaseKeys, knowledgeBaseSettingsQuery } from "../queries.js";
import {
  currentPlace,
  type FolderPlacement,
  type FolderRow,
  flatten,
  indent,
  outdent,
  placementOf,
  project,
  samePlace,
  siblingStep,
} from "./folder-tree.js";
import { IntroductionEditor } from "./introduction-editor.js";

const NO_ICON = "none";
const INDENT_WIDTH = 20;
const UNDO_SECONDS = 5;
const emailSchema = z.email().max(254);

function useSaver<T>(save: (value: T) => Promise<void>) {
  const { t } = useTranslation();
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<T | null>(null);
  const run = async (value: T) => {
    setLast(value);
    setState("saving");
    setError(null);
    try {
      await save(value);
      setState("saved");
    } catch (failure) {
      setError(problemMessage(t, failure));
      setState("error");
    }
  };
  const status = (
    <SaveStatus state={state} {...(error ? { error, onRetry: () => last !== null && void run(last) } : {})} />
  );
  return { run, status };
}

function ContactField({
  label,
  value,
  inherited,
  inheritedFrom,
  editable,
  onSave,
}: {
  label: string;
  value: string | null;
  inherited: string | null;
  inheritedFrom: string | null;
  editable: boolean;
  onSave: (value: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value ?? "");
  const [invalid, setInvalid] = useState<string | null>(null);
  const saver = useSaver(onSave);
  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed === (value ?? "")) return;
    if (trimmed && !emailSchema.safeParse(trimmed).success) {
      setInvalid(t("knowledgeBase.contact.invalid"));
      return;
    }
    setInvalid(null);
    void saver.run(trimmed || null);
  };
  const origin = value
    ? t("knowledgeBase.contact.setHere")
    : inherited && inheritedFrom
      ? t("knowledgeBase.contact.inherited", { source: inheritedFrom })
      : t("knowledgeBase.contact.none");
  return (
    <div className="flex flex-col gap-1">
      <Field label={label} hint={origin} {...(invalid ? { error: invalid } : {})}>
        <Input
          type="email"
          value={draft}
          placeholder={inherited ?? t("knowledgeBase.contact.placeholder")}
          disabled={!editable}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
        />
      </Field>
      {editable ? null : (
        <p className="text-xs text-text-muted">{t("knowledgeBase.folders.contactAdminOnly")}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {editable && value && inheritedFrom ? (
          <Button
            variant="outline"
            size="sm"
            icon={RotateCcw}
            onClick={() => {
              setDraft("");
              setInvalid(null);
              void saver.run(null);
            }}
          >
            {t("knowledgeBase.contact.reset", { source: inheritedFrom })}
          </Button>
        ) : null}
        {saver.status}
      </div>
    </div>
  );
}

function ancestorsOf(all: readonly Category[], folder: Category): Category[] {
  const trail: Category[] = [];
  for (let id = folder.parentId; id; ) {
    const parent = all.find((entry) => entry.id === id);
    if (!parent) break;
    trail.unshift(parent);
    id = parent.parentId;
  }
  return trail;
}

function FolderEditor({
  folder,
  all,
  fallbackSource,
  fallbackContact,
}: {
  folder: Category;
  all: readonly Category[];
  fallbackSource: string;
  fallbackContact: string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { space, canEdit } = useSpace();
  const admin = space.role === "admin" && !space.archived;
  const refresh = () => queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(space.id) });
  const [intro, setIntro] = useState(folder.description);
  const introSaver = useSaver(async (description: string) => {
    await request(() =>
      api.PATCH("/api/v1/items/{itemId}", { params: { path: { itemId: folder.id } }, body: { description } }),
    );
    await refresh();
  });
  const iconSaver = useSaver(async (icon: string | null) => {
    await request(() =>
      api.PUT("/api/v1/categories/{itemId}", { params: { path: { itemId: folder.id } }, body: { icon } }),
    );
    await refresh();
  });
  const ancestors = ancestorsOf(all, folder);
  const withAddress = [...ancestors].reverse().find((entry) => entry.contactEmail);
  const inheritedContact = withAddress?.contactEmail ?? fallbackContact;
  const inheritedSource = withAddress ? withAddress.title : fallbackSource;
  const iconLabel = (name: string) => translateKey(t, `knowledgeBase.icons.${name}`);
  const kind = folder.level === 1 ? t("knowledgeBase.folders.area") : t("knowledgeBase.folders.topic");
  return (
    <Section
      title={
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            {folder.icon ? (
              <NamedIcon name={folder.icon} className="size-icon-md shrink-0 text-accent" />
            ) : (
              <Folder aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
            )}
            <span className="truncate" title={folder.title}>
              {folder.title}
            </span>
            <span className="shrink-0 text-sm font-normal text-text-muted">{kind}</span>
          </span>
          {ancestors.length > 0 ? (
            <span
              className="truncate text-xs font-normal text-text-muted"
              title={ancestors.map((entry) => entry.title).join(" › ")}
            >
              {ancestors.map((entry) => entry.title).join(" › ")}
            </span>
          ) : null}
        </span>
      }
    >
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("knowledgeBase.categories.icon")}</span>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <div className="w-field max-w-full">
                <Combobox
                  aria-label={t("knowledgeBase.categories.icon")}
                  value={folder.icon ?? NO_ICON}
                  items={[
                    { value: NO_ICON, label: t("knowledgeBase.categories.noIcon") },
                    ...ICON_NAMES.map((name) => ({ value: name, label: iconLabel(name), keywords: [name] })),
                  ]}
                  renderItem={(item) => (
                    <span className="flex items-center gap-2">
                      <NamedIcon
                        name={item.value === NO_ICON ? null : item.value}
                        className="size-icon-md shrink-0"
                      />
                      {item.label}
                    </span>
                  )}
                  onValueChange={(value) => {
                    const next = value && value !== NO_ICON ? value : null;
                    if (next !== folder.icon) void iconSaver.run(next);
                  }}
                />
              </div>
            ) : (
              <span className="text-sm">
                {folder.icon ? iconLabel(folder.icon) : t("knowledgeBase.categories.noIcon")}
              </span>
            )}
            {iconSaver.status}
          </div>
          <p className="text-xs text-text-muted">{t("knowledgeBase.categories.iconHint")}</p>
        </div>
        <IntroductionEditor
          value={intro}
          disabled={!canEdit}
          onChange={setIntro}
          onCommit={(next) => {
            if (next.trim() !== folder.description) void introSaver.run(next.trim());
          }}
          status={introSaver.status}
        />
        <ContactField
          key={`${folder.id}:${folder.contactEmail ?? ""}`}
          label={t("knowledgeBase.contact.label")}
          value={folder.contactEmail}
          inherited={inheritedContact}
          inheritedFrom={inheritedContact ? inheritedSource : null}
          editable={admin}
          onSave={async (contactEmail) => {
            await request(() =>
              api.PUT("/api/v1/categories/{itemId}/contact", {
                params: { path: { itemId: folder.id } },
                body: { contactEmail },
              }),
            );
            await refresh();
          }}
        />
      </div>
    </Section>
  );
}

function TreeRow({
  row,
  selected,
  expanded,
  editable,
  depth,
  actions,
  onSelect,
  onToggle,
}: {
  row: FolderRow<Category>;
  selected: boolean;
  expanded: boolean;
  editable: boolean;
  depth: number;
  actions: MenuItem[];
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const sortable = useSortableItem(row.folder.id, !editable);
  const { folder } = row;
  return (
    <li
      ref={sortable.setNodeRef}
      className={classNames(
        "group flex min-h-control-md items-center gap-1 rounded-md pr-1",
        selected ? "bg-accent-soft" : "hover:bg-hover",
        sortable.dragging ? "opacity-50" : "",
      )}
      style={{ paddingLeft: `calc(${depth} * ${INDENT_WIDTH / 16}rem)` }}
    >
      {sortable.handle(t("knowledgeBase.folders.dragHandle", { title: folder.title }))}
      {row.hasChildren ? (
        <IconButton
          label={
            expanded
              ? t("knowledgeBase.folders.collapse", { title: folder.title })
              : t("knowledgeBase.folders.expand", { title: folder.title })
          }
          icon={expanded ? ChevronDown : ChevronRight}
          size="sm"
          aria-expanded={expanded}
          onClick={onToggle}
        />
      ) : (
        <span aria-hidden="true" className="size-control-sm shrink-0" />
      )}
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        className="flex min-h-control-sm min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left focus-visible:focus-ring"
      >
        {folder.icon ? (
          <NamedIcon name={folder.icon} className="size-icon-sm shrink-0 text-accent" />
        ) : (
          <Folder aria-hidden="true" className="size-icon-sm shrink-0 text-text-muted" />
        )}
        <span className={classNames("truncate", selected ? "font-semibold" : "")} title={folder.title}>
          {folder.title}
        </span>
        <span className="ml-auto shrink-0 text-xs text-text-muted">
          {t("knowledgeBase.folders.articles", { count: folder.articles })}
        </span>
      </button>
      {editable && actions.length > 0 ? (
        <Menu
          trigger={
            <IconButton
              label={t("knowledgeBase.folders.actions", { title: folder.title })}
              icon={MoreHorizontal}
              size="sm"
            />
          }
          items={actions}
        />
      ) : null}
    </li>
  );
}

function FolderTreeView({
  all,
  selectedId,
  onSelect,
}: {
  all: Category[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { space, canEdit, openCreate } = useSpace();
  const sensors = useSortableSensors();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const titleOf = (id: string | number) => all.find((folder) => folder.id === id)?.title ?? "";
  const accessibility = useSortableAccessibility(titleOf, "knowledgeBase.folders.drag");
  const rows = useMemo(
    () => flatten(all, activeId ? new Set([...collapsed, activeId]) : collapsed),
    [all, collapsed, activeId],
  );
  const projection =
    activeId && overId ? project(rows, activeId, overId, Math.round(offset / INDENT_WIDTH)) : null;

  const move = (folder: Category, placement: FolderPlacement, undoable = true) => {
    const original = currentPlace(all, folder);
    const run = (confirmation?: string) =>
      request(() =>
        api.POST("/api/v1/items/{itemId}/move", {
          params: { path: { itemId: folder.id } },
          body: confirmation ? { ...placement, confirmation } : placement,
        }),
      ).then(async () => {
        await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(space.id) });
        await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
        toast({
          title: t("knowledgeBase.categories.moved", { title: folder.title }),
          variant: "success",
          ...(undoable
            ? { undo: { onUndo: () => move(folder, original, false), seconds: UNDO_SECONDS } }
            : {}),
        });
      });
    void run().catch((error: unknown) => {
      const impact = moveImpactOf(error);
      if (impact) {
        setPendingMove({ title: folder.title, impact, confirm: run });
        return;
      }
      toast({
        title: t("knowledgeBase.categories.moveFailed"),
        description: problemMessage(t, error),
        variant: "error",
      });
    });
  };

  const finish = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    const projected = over ? project(rows, id, over, Math.round(event.delta.x / INDENT_WIDTH)) : null;
    const placement = projected ? placementOf(rows, id, projected) : null;
    setActiveId(null);
    setOverId(null);
    setOffset(0);
    const folder = all.find((entry) => entry.id === id);
    if (!folder || !placement || !projected) return;
    if (!samePlace(all, folder, placement)) move(folder, placement);
  };

  const actionsOf = (folder: Category): MenuItem[] => {
    const steps: [FolderPlacement | null, string, LucideIcon][] = [
      [siblingStep(all, folder, -1), t("knowledgeBase.categories.moveUp", { title: folder.title }), ArrowUp],
      [
        siblingStep(all, folder, 1),
        t("knowledgeBase.categories.moveDown", { title: folder.title }),
        ArrowDown,
      ],
      [indent(all, folder), t("knowledgeBase.folders.indent"), IndentIncrease],
      [outdent(all, folder), t("knowledgeBase.folders.outdent"), IndentDecrease],
    ];
    return [
      {
        label: t("knowledgeBase.folders.newInside"),
        icon: FolderPlus,
        onSelect: () => openCreate("folder", folder.id),
      },
      { type: "separator" },
      ...steps.flatMap(([placement, label, icon]) =>
        placement ? [{ label, icon, onSelect: () => move(folder, placement) }] : [],
      ),
    ];
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={accessibility}
        onDragStart={(event) => setActiveId(String(event.active.id))}
        onDragMove={(event: DragMoveEvent) => {
          setOffset(event.delta.x);
          setOverId(event.over ? String(event.over.id) : null);
        }}
        onDragCancel={() => {
          setActiveId(null);
          setOverId(null);
          setOffset(0);
        }}
        onDragEnd={finish}
      >
        <SortableContext items={rows.map((row) => row.folder.id)} strategy={verticalListSortingStrategy}>
          <ul aria-label={t("knowledgeBase.folders.tree")} className="flex flex-col gap-px p-2">
            {rows.map((row) => (
              <TreeRow
                key={row.folder.id}
                row={row}
                depth={row.folder.id === activeId && projection ? projection.depth : row.depth}
                selected={row.folder.id === selectedId}
                expanded={!collapsed.has(row.folder.id)}
                editable={canEdit}
                actions={canEdit ? actionsOf(row.folder) : []}
                onSelect={() => onSelect(row.folder.id)}
                onToggle={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(row.folder.id)) next.delete(row.folder.id);
                    else next.add(row.folder.id);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </SortableContext>
        <DragOverlay>
          {activeId ? (
            <div className="rounded-md border border-border bg-surface px-3 py-2 font-medium shadow-popover">
              {titleOf(activeId)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <MoveConfirmDialog pending={pendingMove} onChange={setPendingMove} />
    </>
  );
}

export function CategoriesScreen() {
  const { t } = useTranslation();
  const { space, canEdit, openCreate } = useSpace();
  const queryClient = useQueryClient();
  const categories = useQuery({ ...categoriesQuery(space.id), throwOnError: false });
  const settings = useQuery({ ...knowledgeBaseSettingsQuery(space.id), throwOnError: false });
  const admin = space.role === "admin" && !space.archived;
  const all = categories.data ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = all.find((folder) => folder.id === chosen) ?? all[0] ?? null;
  const fallbackSource = t("knowledgeBase.contact.knowledgeBase");
  return (
    <SpaceSettingsPage
      title={t("knowledgeBase.folders.title")}
      description={t("knowledgeBase.folders.description")}
    >
      <div className="flex flex-col gap-6">
        <Panel
          title={t("knowledgeBase.contact.knowledgeBaseTitle")}
          description={t("knowledgeBase.contact.hint")}
        >
          {settings.isError ? (
            <LoadError
              what={t("knowledgeBase.audience.loadFailed")}
              error={settings.error}
              onRetry={() => settings.refetch()}
            />
          ) : settings.data ? (
            <ContactField
              key={settings.data.contactEmail ?? ""}
              label={t("knowledgeBase.contact.label")}
              value={settings.data.contactEmail}
              inherited={null}
              inheritedFrom={null}
              editable={admin}
              onSave={async (contactEmail) => {
                await request(() =>
                  api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/contact", {
                    params: { path: { spaceId: space.id } },
                    body: { contactEmail },
                  }),
                );
                await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(space.id) });
              }}
            />
          ) : (
            <Skeleton className="h-field w-full" />
          )}
        </Panel>
        {categories.isPending ? <Skeleton className="h-field w-full" /> : null}
        {categories.isError ? (
          <LoadError
            what={t("knowledgeBase.list.categoriesFailed")}
            error={categories.error}
            onRetry={() => categories.refetch()}
          />
        ) : null}
        {categories.data && all.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title={t("knowledgeBase.folders.emptyTitle")}
            description={t("knowledgeBase.folders.emptyEditor")}
            action={
              canEdit ? (
                <Button variant="primary" onClick={() => openCreate("folder", null)}>
                  {t("knowledgeBase.folders.newArea")}
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {all.length > 0 && selected ? (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <Section
              title={t("knowledgeBase.folders.tree")}
              actions={
                canEdit ? (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={FolderPlus}
                    onClick={() => openCreate("folder", null)}
                  >
                    {t("knowledgeBase.folders.newArea")}
                  </Button>
                ) : undefined
              }
            >
              <FolderTreeView all={all} selectedId={selected.id} onSelect={setChosen} />
              {canEdit ? (
                <p className="px-4 pb-3 text-xs text-text-muted">{t("knowledgeBase.folders.treeHint")}</p>
              ) : null}
            </Section>
            <FolderEditor
              key={selected.id}
              folder={selected}
              all={all}
              fallbackSource={fallbackSource}
              fallbackContact={settings.data?.contactEmail ?? null}
            />
          </div>
        ) : null}
      </div>
    </SpaceSettingsPage>
  );
}
