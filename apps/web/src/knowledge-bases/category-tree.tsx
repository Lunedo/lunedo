import { IconButton, Menu, SegmentedControl } from "@lunedo/ui";
import { Lock, MoreHorizontal, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { preferenceKeys, useUpdatePreference } from "../preferences/preferences.js";
import { usePreferences } from "../preferences/preferences-provider.js";
import { useSpace } from "../spaces/space-context.js";
import type { SpaceWithRole, TreeItem } from "../spaces/space-queries.js";
import { type CategoryView, PageTree } from "../spaces/tree/page-tree.js";
import { type CategoryAccess, useCategoryAccess } from "./category-access.js";

export function rootsWithMine(entries: readonly CategoryAccess[]): Set<string> {
  const byId = new Map(entries.map((entry) => [entry.itemId, entry]));
  const roots = new Set<string>();
  for (const entry of entries) {
    if (!entry.mine) continue;
    let current: CategoryAccess | undefined = entry;
    while (current?.parentId && byId.has(current.parentId)) current = byId.get(current.parentId);
    if (current) roots.add(current.itemId);
  }
  return roots;
}

export function CategoryTree({
  space,
  currentId,
  ancestors,
}: {
  space: SpaceWithRole;
  currentId: string | null;
  ancestors: readonly string[];
}) {
  const { t } = useTranslation();
  const preferences = usePreferences();
  const updatePreference = useUpdatePreference();
  const context = useSpace();
  const access = useCategoryAccess(space.id, true);
  const entries = useMemo(() => access.data ?? [], [access.data]);
  const mineRoots = useMemo(() => rootsWithMine(entries), [entries]);
  const hasMine = mineRoots.size > 0;
  const view = hasMine
    ? preferences.categoryView === "automatic"
      ? "mine"
      : preferences.categoryView
    : "all";
  const readableRoots = entries.filter((entry) => entry.parentId === null && entry.readable);
  const others = readableRoots.filter((entry) => !mineRoots.has(entry.itemId)).length;
  const hidden = entries.filter((entry) => !entry.readable);
  const categories = useMemo<CategoryView>(
    () => ({
      entries: new Map(entries.map((entry) => [entry.itemId, entry])),
      shown: view === "mine" ? (item: TreeItem) => item.kind === "folder" && mineRoots.has(item.id) : null,
    }),
    [entries, view, mineRoots],
  );
  const choose = (value: string) =>
    updatePreference.mutate({ key: preferenceKeys.categoryView, value: value === "mine" ? "mine" : "all" });

  return (
    <>
      {hasMine ? (
        <div className="px-2 pb-2">
          <SegmentedControl
            label={t("categoryAccess.viewLabel")}
            value={view}
            onValueChange={choose}
            options={[
              { value: "mine", label: t("categoryAccess.mine") },
              { value: "all", label: t("categoryAccess.all") },
            ]}
          />
        </div>
      ) : null}
      <PageTree space={space} currentId={currentId} ancestors={ancestors} categories={categories} />
      {view === "mine" && others > 0 ? (
        <p className="px-2 py-2 text-sm text-text-muted">
          {t("categoryAccess.moreToRead", { count: others })} ·{" "}
          <button type="button" className="text-accent underline" onClick={() => choose("all")}>
            {t("categoryAccess.showAll")}
          </button>
        </p>
      ) : null}
      {hidden.length > 0 && context.openCategoryAccess ? (
        <section aria-labelledby="hidden-categories" className="flex flex-col gap-1 px-2 pt-3">
          <h3 id="hidden-categories" className="text-2xs font-bold tracking-label text-text-muted uppercase">
            {t("categoryAccess.hiddenTitle")}
          </h3>
          <p className="text-sm text-text-muted">{t("categoryAccess.hiddenHint")}</p>
          <ul className="flex flex-col">
            {hidden.map((entry) => (
              <li key={entry.itemId} className="flex h-row min-w-0 items-center gap-2 rounded-sm px-2">
                <Lock aria-hidden="true" className="size-icon-sm shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1 truncate text-text-muted" title={entry.title}>
                  {entry.title}
                </span>
                <Menu
                  trigger={
                    <IconButton
                      size="sm"
                      label={t("tree.actionsFor", { title: entry.title })}
                      icon={MoreHorizontal}
                    />
                  }
                  items={[
                    {
                      label: t("categoryAccess.action"),
                      icon: ShieldCheck,
                      onSelect: () => context.openCategoryAccess?.(entry.itemId),
                    },
                  ]}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
