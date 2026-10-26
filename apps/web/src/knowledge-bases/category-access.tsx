import {
  Button,
  Combobox,
  type ComboboxItem,
  ConfirmDialog,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Notice,
  RadioGroup,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, PencilLine, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { isApiError, request } from "../api/request.js";
import { groupLoader } from "../components/pickers.js";
import { ActionFailure } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import type { SpaceWithRole } from "../spaces/space-queries.js";
import { knowledgeBaseKeys, type Ok } from "./queries.js";

export type CategoryAccess = Ok<"/api/v1/spaces/{spaceId}/knowledge-base/category-access", "get">[number];
type CategoryGroup = NonNullable<CategoryAccess["visibleTo"]>[number];
type Effect = Ok<"/api/v1/spaces/{spaceId}/knowledge-base/categories/{itemId}/access/preview", "post">;

export function categoryAccessQuery(spaceId: string) {
  return queryOptions({
    queryKey: [...knowledgeBaseKeys.all(spaceId), "categoryAccess"] as const,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/knowledge-base/category-access", { params: { path: { spaceId } } }),
      ),
  });
}

export function useCategoryAccess(spaceId: string, enabled: boolean) {
  return useQuery({ ...categoryAccessQuery(spaceId), enabled, throwOnError: false });
}

function groupItems(groups: readonly CategoryGroup[] | null): ComboboxItem[] {
  return (groups ?? []).map((group) => ({ value: group.id, label: group.name }));
}

function GroupChips({ groups }: { groups: readonly CategoryGroup[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {groups.map((group) => (
        <li
          key={group.id}
          className="inline-flex max-w-full items-center gap-1 rounded-sm bg-surface-muted px-2 py-0.5 text-sm"
          title={group.name}
        >
          <Users aria-hidden="true" className="size-icon-sm shrink-0 text-text-muted" />
          <span className="truncate">{group.name}</span>
        </li>
      ))}
    </ul>
  );
}

export function CategoryAccessSummary({ entry }: { entry: CategoryAccess }) {
  const { t } = useTranslation();
  const responsible = entry.responsibleGroups ?? entry.inheritedResponsibleGroups;
  const visible = entry.visibleTo ?? entry.inheritedVisibleTo;
  return (
    <div className="flex flex-col gap-3">
      {visible ? (
        <Notice variant="warning" title={t("categoryAccess.restrictedTitle")}>
          {t("categoryAccess.restrictedNote", { groups: visible.map((group) => group.name).join(", ") })}
        </Notice>
      ) : null}
      <dl className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-sm text-text-muted">{t("categoryAccess.responsible")}</dt>
          <dd className="min-w-0">
            {responsible && responsible.length > 0 ? (
              <GroupChips groups={responsible} />
            ) : (
              <span className="text-sm">
                {responsible ? t("categoryAccess.onlySpaceAdmins") : t("categoryAccess.allEditors")}
              </span>
            )}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-sm text-text-muted">{t("categoryAccess.visibleTo")}</dt>
          <dd className="min-w-0">
            {visible ? (
              <GroupChips groups={visible} />
            ) : (
              <span className="text-sm">{t("categoryAccess.likeKnowledgeBase")}</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function EffectText({ effect }: { effect: Effect }) {
  const { t } = useTranslation();
  const lines: string[] = [];
  if (effect.losingWriteCount > 0) {
    const names = effect.losingWrite.map((change) => change.name);
    lines.push(
      names.length > 0 && names.length === effect.losingWriteCount
        ? t("categoryAccess.effect.losingWriteNamed", {
            count: effect.losingWriteCount,
            names: names.join(", "),
            articles: effect.articles,
          })
        : t("categoryAccess.effect.losingWrite", {
            count: effect.losingWriteCount,
            articles: effect.articles,
          }),
    );
  }
  if (effect.losingRead > 0) {
    lines.push(
      t("categoryAccess.effect.losingRead", { count: effect.losingRead, articles: effect.articles }),
    );
  }
  if (effect.publicPortalLosesAccess) lines.push(t("categoryAccess.effect.publicPortal"));
  if (effect.gainingRead > 0) {
    lines.push(
      t("categoryAccess.effect.gainingRead", { count: effect.gainingRead, articles: effect.articles }),
    );
  }
  if (lines.length === 0) lines.push(t("categoryAccess.effect.nothing"));
  return (
    <div role="status" className="rounded-md bg-accent-soft p-3 text-sm text-text">
      <p className="font-semibold">{t("categoryAccess.effect.title")}</p>
      <ul className="mt-1 flex list-disc flex-col gap-1 ps-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function CategoryAccessDialog({
  space,
  entry,
  open,
  onOpenChange,
}: {
  space: SpaceWithRole;
  entry: CategoryAccess;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [responsible, setResponsible] = useState<ComboboxItem[]>(() => groupItems(entry.responsibleGroups));
  const [restricted, setRestricted] = useState(entry.visibleTo !== null);
  const [visible, setVisible] = useState<ComboboxItem[]>(() => groupItems(entry.visibleTo));
  const [effect, setEffect] = useState<Effect | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const loader = useMemo(
    () => (space.organizationId ? groupLoader(space.organizationId) : undefined),
    [space.organizationId],
  );
  const body = useMemo(
    () => ({
      responsibleGroupIds: responsible.map((item) => item.value),
      visibleGroupIds: restricted ? visible.map((item) => item.value) : null,
    }),
    [responsible, restricted, visible],
  );
  const path = { spaceId: space.id, itemId: entry.itemId };

  useEffect(() => {
    if (!open || (restricted && visible.length === 0)) {
      setEffect(null);
      return;
    }
    let current = true;
    void request(() =>
      api.POST("/api/v1/spaces/{spaceId}/knowledge-base/categories/{itemId}/access/preview", {
        params: { path: { spaceId: space.id, itemId: entry.itemId } },
        body,
      }),
    ).then(
      (result) => {
        if (current) {
          setEffect(result);
          setFailure(null);
        }
      },
      (error: unknown) => {
        if (current) setFailure(problemMessage(t, error));
      },
    );
    return () => {
      current = false;
    };
  }, [open, body, restricted, visible.length, space.id, entry.itemId, t]);

  const apply = async (confirmWidening: boolean) => {
    setSaving(true);
    setFailure(null);
    try {
      await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/categories/{itemId}/access", {
          params: { path },
          body: { ...body, confirmWidening },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(space.id) });
      await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
      setConfirming(null);
      onOpenChange(false);
      toast({ title: t("categoryAccess.saved", { name: entry.title }) });
    } catch (error) {
      if (isApiError(error, "categoryVisibilityWidening")) {
        setConfirming(Number(error.problem.articles ?? 0));
      } else {
        setConfirming(null);
        setFailure(problemMessage(t, error));
      }
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (restricted && visible.length === 0) {
      setGroupsError(t("categoryAccess.visibleGroupsMissing"));
      focusFirstInvalidSoon();
      return;
    }
    setGroupsError(null);
    void apply(false);
  };

  const inheritedResponsible = entry.inheritedResponsibleGroups;
  const inheritedVisible = entry.inheritedVisibleTo;
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={t("categoryAccess.dialogTitle", { name: entry.title })}
        description={t("categoryAccess.dialogDescription", {
          articles: entry.articles,
          subcategories: entry.subcategories,
        })}
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <span className="me-auto text-sm text-text-muted">{t("categoryAccess.audited")}</span>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {t("categoryAccess.save")}
            </Button>
          </div>
        }
      >
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {failure ? <ActionFailure title={t("categoryAccess.saveFailed")} message={failure} /> : null}
          <Field
            label={
              <span className="inline-flex items-center gap-1">
                <PencilLine aria-hidden="true" className="size-icon-sm" />
                {t("categoryAccess.responsible")}
              </span>
            }
            hint={
              inheritedResponsible
                ? t("categoryAccess.responsibleInherited", {
                    groups: inheritedResponsible.map((group) => group.name).join(", "),
                  })
                : t("categoryAccess.responsibleHint")
            }
          >
            <Combobox
              multiple
              value={responsible.map((item) => item.value)}
              selectedItems={responsible}
              load={loader}
              placeholder={t("categoryAccess.addGroup")}
              onValueChange={(_value, items) => setResponsible(items)}
            />
          </Field>
          <p className="-mt-3 text-sm text-text-muted">{t("categoryAccess.responsibleEmpty")}</p>
          <RadioGroup
            label={t("categoryAccess.visibleTo")}
            heading={
              <span className="inline-flex items-center gap-1">
                <Eye aria-hidden="true" className="size-icon-sm" />
                {t("categoryAccess.visibleTo")}
              </span>
            }
            variant="card"
            value={restricted ? "groups" : "knowledgeBase"}
            onValueChange={(value) => setRestricted(value === "groups")}
            options={[
              {
                value: "knowledgeBase",
                label: t("categoryAccess.visibility.knowledgeBase.title"),
                description: inheritedVisible
                  ? t("categoryAccess.visibility.inherited", {
                      groups: inheritedVisible.map((group) => group.name).join(", "),
                    })
                  : t("categoryAccess.visibility.knowledgeBase.description"),
              },
              {
                value: "groups",
                label: t("categoryAccess.visibility.groups.title"),
                description: t("categoryAccess.visibility.groups.description"),
              },
            ]}
          />
          {restricted ? (
            <Field
              id="category-visible-groups"
              label={t("categoryAccess.visibleGroups")}
              {...(groupsError ? { error: groupsError } : {})}
            >
              <Combobox
                multiple
                invalid={groupsError !== null}
                value={visible.map((item) => item.value)}
                selectedItems={visible}
                load={loader}
                placeholder={t("categoryAccess.addGroup")}
                onValueChange={(_value, items) => setVisible(items)}
              />
            </Field>
          ) : null}
          {entry.visibleToPeople > 0 && restricted ? (
            <Notice variant="info" title={t("categoryAccess.peopleTitle")}>
              {t("categoryAccess.people", { count: entry.visibleToPeople })}
            </Notice>
          ) : null}
          {effect ? <EffectText effect={effect} /> : <Skeleton className="h-field w-full" />}
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(null);
        }}
        title={t("categoryAccess.widenTitle")}
        description={t("categoryAccess.widenDescription", { count: confirming ?? 0, name: entry.title })}
        confirmLabel={t("categoryAccess.widenConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => apply(true)}
      />
    </>
  );
}

export function CategoryIcons({ entry, canEdit }: { entry: CategoryAccess | undefined; canEdit: boolean }) {
  const { t } = useTranslation();
  if (!entry) return null;
  return (
    <>
      {canEdit && !entry.writable ? (
        <span className="inline-flex shrink-0 text-text-muted" title={t("categoryAccess.readOnly")}>
          <Eye aria-hidden="true" className="size-icon-sm" />
          <span className="sr-only">{t("categoryAccess.readOnly")}</span>
        </span>
      ) : null}
    </>
  );
}
