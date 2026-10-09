import { renderHtml } from "@pagehall/editor-schema";
import {
  Button,
  Combobox,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  Input,
  Select,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FilePlus, LayoutTemplate, Search } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { readViewContext } from "../../editor/read-view.js";
import { searchPeople } from "../../editor/references.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { galleryQuery, type PageTemplate, type TemplateField } from "../content-queries.js";
import { itemHref } from "../item-paths.js";
import type { SpaceWithRole } from "../space-queries.js";
import { TEMPLATE_CATEGORIES } from "./template-categories.js";
import "../../editor/editor.css";

const BLANK = "blank";

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function TemplateGallery({
  space,
  parentId,
  onOpenChange,
  onSeriesTemplate,
}: {
  space: SpaceWithRole;
  parentId: string | null | undefined;
  onOpenChange: (open: boolean) => void;
  onSeriesTemplate?: (templateId: string) => void;
}) {
  const { t } = useTranslation();
  const name = space.personal && !space.name ? t("spaces.personal.label") : space.name;
  return (
    <Dialog
      open={parentId !== undefined}
      onOpenChange={onOpenChange}
      title={t("gallery.title", { space: name })}
      size="lg"
    >
      {parentId !== undefined ? (
        <GalleryContent
          space={space}
          parentId={parentId}
          onDone={() => onOpenChange(false)}
          {...(onSeriesTemplate ? { onSeriesTemplate } : {})}
        />
      ) : null}
    </Dialog>
  );
}

function GalleryContent({
  space,
  parentId,
  onDone,
  onSeriesTemplate,
}: {
  space: SpaceWithRole;
  parentId: string | null;
  onDone: () => void;
  onSeriesTemplate?: (templateId: string) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const gallery = useQuery(galleryQuery(space.id));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<string>(BLANK);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  const templates = gallery.data ?? [];
  const term = query.trim().toLowerCase();
  const visible = templates.filter(
    (template) =>
      (category === "all" || template.category === category) &&
      (!term || `${template.name} ${template.description}`.toLowerCase().includes(term)),
  );
  const template = templates.find((candidate) => candidate.id === selected) ?? null;
  const categories = TEMPLATE_CATEGORIES.filter((value) =>
    templates.some((entry) => entry.category === value),
  );

  const choose = (id: string) => {
    setSelected(id);
    setErrors({});
    const next = templates.find((candidate) => candidate.id === id);
    setValues(
      Object.fromEntries(
        (next?.fields ?? []).filter((field) => field.type === "date").map((field) => [field.key, today()]),
      ),
    );
  };

  const create = async () => {
    if (template?.series && onSeriesTemplate) {
      onDone();
      onSeriesTemplate(template.id);
      return;
    }
    if (template) {
      const found: Record<string, string> = {};
      for (const field of template.fields) {
        if (field.required && !(values[field.key] ?? "").trim())
          found[field.key] = t("gallery.required", { label: field.label });
      }
      setErrors(found);
      if (Object.keys(found).length > 0) {
        focusFirstInvalidSoon();
        return;
      }
    }
    setCreating(true);
    try {
      const created = await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/items", {
          params: { path: { spaceId: space.id } },
          body: template
            ? {
                kind: "page",
                title: "",
                parentId,
                template: {
                  id: template.id,
                  values: Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())),
                },
              }
            : { kind: "page", title: t("tree.untitledPage"), parentId },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
      onDone();
      const href = itemHref(created, space.key);
      if (href) await navigate({ to: href, search: { edit: true } });
    } catch (error) {
      toast({ title: t("tree.createFailed"), description: problemMessage(t, error), variant: "error" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-field">
          <Field label={t("gallery.search")}>
            <Input
              type="search"
              value={query}
              placeholder={t("gallery.searchPlaceholder")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
        </div>
        <Field label={t("gallery.category")}>
          <Select
            value={category}
            onValueChange={setCategory}
            options={[
              { value: "all", label: t("gallery.allCategories") },
              ...categories.map((value) => ({ value, label: t(`templates.categories.${value}`) })),
            ]}
          />
        </Field>
      </div>
      {gallery.isError ? (
        <LoadError what={t("gallery.loadFailed")} error={gallery.error} onRetry={() => gallery.refetch()} />
      ) : gallery.isPending ? (
        <Skeleton className="h-field w-full" />
      ) : (
        <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          <legend className="sr-only">{t("gallery.templates")}</legend>
          {!term && category === "all" ? (
            <TemplateCard
              selected={selected === BLANK}
              onSelect={() => choose(BLANK)}
              icon={<FilePlus aria-hidden="true" className="size-icon text-text-muted" />}
              title={t("gallery.blank")}
              description={t("gallery.blankDescription")}
            />
          ) : null}
          {visible.map((entry) => (
            <TemplateCard
              key={entry.id}
              selected={selected === entry.id}
              onSelect={() => choose(entry.id)}
              icon={<LayoutTemplate aria-hidden="true" className="size-icon text-text-muted" />}
              title={entry.name}
              description={entry.description}
              origin={entry.level === "builtIn" ? undefined : t(`gallery.levels.${entry.level}`)}
            />
          ))}
          {visible.length === 0 && (term || category !== "all") ? (
            <div className="sm:col-span-2 md:col-span-3">
              <EmptyState
                icon={Search}
                title={t("gallery.noResults")}
                description={t("gallery.noResultsDescription")}
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery("");
                      setCategory("all");
                    }}
                  >
                    {t("gallery.clearFilters")}
                  </Button>
                }
              />
            </div>
          ) : null}
        </fieldset>
      )}
      {template ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <TemplatePreview template={template} />
          <div className="flex flex-col gap-3">
            {template.series ? (
              <p className="text-sm text-text-muted">{t("gallery.seriesTemplate")}</p>
            ) : null}
            {template.series ? null : template.fields.length === 0 ? (
              <p className="text-sm text-text-muted">{t("gallery.noInput")}</p>
            ) : (
              template.fields.map((field) => (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ""}
                  error={errors[field.key]}
                  onChange={(value) => {
                    setValues((current) => ({ ...current, [field.key]: value }));
                    if (errors[field.key] && value.trim()) {
                      setErrors((current) => {
                        const { [field.key]: _removed, ...rest } = current;
                        return rest;
                      });
                    }
                  }}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={creating}>
          {template?.series && onSeriesTemplate
            ? t("gallery.createSeriesFrom", { name: template.name })
            : template
              ? t("gallery.createFrom", { name: template.name })
              : t("gallery.createBlank")}
        </Button>
      </div>
    </form>
  );
}

function TemplateCard({
  selected,
  onSelect,
  icon,
  title,
  description,
  origin,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
  origin?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-hit flex-col items-start gap-1 rounded-md border p-3 text-start focus-visible:focus-ring ${selected ? "border-accent bg-accent-soft" : "border-border hover:bg-hover"}`}
    >
      <span className="flex w-full items-center gap-2">
        {icon}
        <span className="line-clamp-2 min-w-0 flex-1 font-medium break-words hyphens-auto" title={title}>
          {title}
        </span>
      </span>
      <span className="line-clamp-2 text-sm text-text-muted" title={description}>
        {description}
      </span>
      {origin ? <span className="text-xs text-text-muted">{origin}</span> : null}
    </button>
  );
}

function TemplatePreview({ template }: { template: PageTemplate }) {
  const { t } = useTranslation();
  const format = useFormat();
  const html = useMemo(() => {
    try {
      return renderHtml(template.document, {
        ...readViewContext({ people: {}, pages: {} }, t, format),
        showPlaceholders: true,
      });
    } catch {
      return null;
    }
  }, [template.document, t, format]);
  return (
    <section aria-label={t("gallery.preview")} className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold text-text-muted">{t("gallery.preview")}</h3>
      <div
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the preview scrolls and must be reachable by keyboard
        tabIndex={0}
        className="ph-content ph-read-view max-h-dialog-sm overflow-y-auto rounded-md border border-border bg-surface p-3 text-sm"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated template
        dangerouslySetInnerHTML={{ __html: html ?? "" }}
      />
    </section>
  );
}

function FieldInput({
  field,
  value,
  error,
  onChange,
}: {
  field: TemplateField;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [person, setPerson] = useState<{ value: string; label: string } | null>(null);
  const hint = field.required ? undefined : t("gallery.optional");
  switch (field.type) {
    case "date":
      return (
        <Field label={field.label} hint={hint} error={error} required={field.required}>
          <Input
            type="date"
            value={value}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
    case "choice":
      return (
        <Field label={field.label} hint={hint} error={error} required={field.required}>
          <Select
            value={value || undefined}
            invalid={Boolean(error)}
            placeholder={t("gallery.choose")}
            onValueChange={onChange}
            options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
          />
        </Field>
      );
    case "person":
      return (
        <Field label={field.label} hint={hint} error={error} required={field.required}>
          <Combobox
            value={value || null}
            selectedItem={person}
            invalid={Boolean(error)}
            placeholder={t("gallery.searchPerson")}
            load={async (query) => ({
              items: (await searchPeople(query)).map((entry) => ({
                value: entry.id,
                label: entry.name,
                ...(entry.email ? { description: entry.email } : {}),
              })),
            })}
            onValueChange={(next, item) => {
              setPerson(item ? { value: item.value, label: item.label } : null);
              onChange(next ?? "");
            }}
          />
        </Field>
      );
    default:
      return (
        <Field label={field.label} hint={hint} error={error} required={field.required}>
          <Input
            value={value}
            maxLength={200}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
  }
}
