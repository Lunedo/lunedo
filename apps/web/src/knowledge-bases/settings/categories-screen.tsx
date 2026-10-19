import {
  Button,
  Combobox,
  EmptyState,
  Field,
  IconButton,
  Input,
  type SaveState,
  SaveStatus,
  Section,
  Skeleton,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Folder, FolderTree, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { Panel } from "../../spaces/settings/panel.js";
import { SpaceSettingsPage } from "../../spaces/settings/space-settings-page.js";
import { useSpace } from "../../spaces/space-context.js";
import { ICON_NAMES, NamedIcon } from "../icons.js";
import { type Category, categoriesQuery, knowledgeBaseKeys, knowledgeBaseSettingsQuery } from "../queries.js";

const INTRO_MAX = 1000;
const NO_ICON = "none";
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

function CategoryCard({
  category,
  parent,
  siblings,
  fallbackSource,
  fallbackContact,
}: {
  category: Category;
  parent: Category | null;
  siblings: Category[];
  fallbackSource: string;
  fallbackContact: string | null;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { space, canEdit } = useSpace();
  const admin = space.role === "admin" && !space.archived;
  const refresh = () => queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(space.id) });
  const [intro, setIntro] = useState(category.description);
  const introSaver = useSaver(async (description: string) => {
    await request(() =>
      api.PATCH("/api/v1/items/{itemId}", {
        params: { path: { itemId: category.id } },
        body: { description },
      }),
    );
    await refresh();
  });
  const iconSaver = useSaver(async (icon: string | null) => {
    await request(() =>
      api.PUT("/api/v1/categories/{itemId}", { params: { path: { itemId: category.id } }, body: { icon } }),
    );
    await refresh();
  });
  const index = siblings.findIndex((sibling) => sibling.id === category.id);
  const move = async (direction: -1 | 1) => {
    const neighbor = siblings[index + direction];
    if (!neighbor) return;
    try {
      await request(() =>
        api.POST("/api/v1/items/{itemId}/move", {
          params: { path: { itemId: category.id } },
          body:
            direction < 0
              ? { parentId: category.parentId, beforeId: neighbor.id }
              : { parentId: category.parentId, afterId: neighbor.id },
        }),
      );
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
      toast({ title: t("knowledgeBase.categories.moved", { title: category.title }), variant: "success" });
    } catch (error) {
      toast({
        title: t("knowledgeBase.categories.moveFailed"),
        description: problemMessage(t, error),
        variant: "error",
      });
    }
  };
  const parentContact = parent ? parent.effectiveContactEmail : fallbackContact;
  const inheritedContact = category.contactEmail ? parentContact : category.effectiveContactEmail;
  const fromParent = parent?.contactEmail ? parent.title : null;
  const inheritedSource = category.contactEmail
    ? (fromParent ?? fallbackSource)
    : category.contactSource === "parentCategory"
      ? (parent?.title ?? fallbackSource)
      : fallbackSource;
  const iconLabel = (name: string) => translateKey(t, `knowledgeBase.icons.${name}`);
  return (
    <Section
      title={
        <span className="flex min-w-0 items-center gap-2">
          <NamedIcon name={category.icon} className="size-icon shrink-0 text-text-muted" />
          {category.icon ? null : (
            <Folder aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
          )}
          <span className="truncate" title={category.title}>
            {category.title}
          </span>
          {parent ? (
            <span className="truncate text-sm font-normal text-text-muted">
              {t("knowledgeBase.categories.inParent", { parent: parent.title })}
            </span>
          ) : null}
        </span>
      }
      actions={
        canEdit ? (
          <span className="flex gap-1">
            {index > 0 ? (
              <IconButton
                label={t("knowledgeBase.categories.moveUp", { title: category.title })}
                icon={ArrowUp}
                size="sm"
                onClick={() => void move(-1)}
              />
            ) : null}
            {index < siblings.length - 1 ? (
              <IconButton
                label={t("knowledgeBase.categories.moveDown", { title: category.title })}
                icon={ArrowDown}
                size="sm"
                onClick={() => void move(1)}
              />
            ) : null}
          </span>
        ) : undefined
      }
    >
      <div className="grid gap-4 p-4 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("knowledgeBase.categories.icon")}</span>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <div className="w-field max-w-full">
                <Combobox
                  aria-label={t("knowledgeBase.categories.icon")}
                  value={category.icon ?? NO_ICON}
                  items={[
                    { value: NO_ICON, label: t("knowledgeBase.categories.noIcon") },
                    ...ICON_NAMES.map((name) => ({ value: name, label: iconLabel(name), keywords: [name] })),
                  ]}
                  renderItem={(item) => (
                    <span className="flex items-center gap-2">
                      <NamedIcon
                        name={item.value === NO_ICON ? null : item.value}
                        className="size-icon shrink-0"
                      />
                      {item.label}
                    </span>
                  )}
                  onValueChange={(value) => {
                    const next = value && value !== NO_ICON ? value : null;
                    if (next !== category.icon) void iconSaver.run(next);
                  }}
                />
              </div>
            ) : (
              <span className="text-sm">
                {category.icon ? iconLabel(category.icon) : t("knowledgeBase.categories.noIcon")}
              </span>
            )}
            {iconSaver.status}
          </div>
          <p className="text-xs text-text-muted">{t("knowledgeBase.categories.iconHint")}</p>
        </div>
        <ContactField
          key={category.contactEmail ?? ""}
          label={t("knowledgeBase.contact.label")}
          value={category.contactEmail}
          inherited={inheritedContact}
          inheritedFrom={inheritedContact ? inheritedSource : null}
          editable={admin}
          onSave={async (contactEmail) => {
            await request(() =>
              api.PUT("/api/v1/categories/{itemId}/contact", {
                params: { path: { itemId: category.id } },
                body: { contactEmail },
              }),
            );
            await refresh();
          }}
        />
        <div className="flex flex-col gap-1 md:col-span-2">
          <Field label={t("knowledgeBase.categories.intro")} hint={t("knowledgeBase.categories.introHint")}>
            <Textarea
              rows={2}
              maxLength={INTRO_MAX}
              value={intro}
              disabled={!canEdit}
              onChange={(event) => setIntro(event.target.value)}
              onBlur={() => {
                if (intro.trim() !== category.description) void introSaver.run(intro.trim());
              }}
            />
          </Field>
          {introSaver.status}
        </div>
      </div>
    </Section>
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
  const top = all.filter((category) => category.level === 1);
  const childrenOf = (parent: Category) => all.filter((category) => category.parentId === parent.id);
  const fallbackSource = t("knowledgeBase.contact.knowledgeBase");
  return (
    <SpaceSettingsPage
      tab="categories"
      title={t("knowledgeBase.categories.title")}
      description={t("knowledgeBase.categories.description")}
      icon={FolderTree}
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
        {categories.data && top.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title={t("knowledgeBase.list.noCategoriesTitle")}
            description={t("knowledgeBase.list.noCategoriesEditor")}
            action={
              canEdit ? (
                <Button variant="primary" onClick={() => openCreate("folder", null)}>
                  {t("knowledgeBase.newCategory")}
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {top.map((category) => (
          <div key={category.id} className="flex flex-col gap-3">
            <CategoryCard
              category={category}
              parent={null}
              siblings={top}
              fallbackSource={fallbackSource}
              fallbackContact={settings.data?.contactEmail ?? null}
            />
            {childrenOf(category).length > 0 ? (
              <div className="flex flex-col gap-3 border-l-2 border-border pl-4">
                {childrenOf(category).map((child) => (
                  <CategoryCard
                    key={child.id}
                    category={child}
                    parent={category}
                    siblings={childrenOf(category)}
                    fallbackSource={fallbackSource}
                    fallbackContact={settings.data?.contactEmail ?? null}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </SpaceSettingsPage>
  );
}
