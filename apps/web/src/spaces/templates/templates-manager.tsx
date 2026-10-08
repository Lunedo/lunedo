import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Input,
  Menu,
  Select,
  Skeleton,
  Table,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { LayoutTemplate, Pencil, Plus, Trash2, X } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import type { PageTemplate, TemplateField } from "../content-queries.js";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "./template-categories.js";

const TemplateContentEditor = lazy(() =>
  import("../../editor/template-content-editor.js").then((module) => ({
    default: module.TemplateContentEditor,
  })),
);

const FIELD_TYPES = ["text", "date", "person", "choice"] as const;
const KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,39}$/;
const EMPTY_DOCUMENT = { type: "doc", content: [{ type: "paragraph" }] };

export interface TemplateInput {
  name: string;
  description: string;
  category: TemplateCategory;
  title: string;
  fields: TemplateField[];
  document: unknown;
}

export function TemplatesManager({
  templates,
  loading,
  error,
  onRetry,
  canManage,
  onCreate,
  onUpdate,
  onDelete,
}: {
  templates: PageTemplate[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  canManage: boolean;
  onCreate: (input: TemplateInput) => Promise<unknown>;
  onUpdate: (id: string, input: TemplateInput) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const [editing, setEditing] = useState<PageTemplate | "new" | null>(null);
  const [deleting, setDeleting] = useState<PageTemplate | null>(null);
  if (error) return <LoadError what={t("templates.loadFailed")} error={error} onRetry={onRetry} />;
  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div>
          <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
            {t("templates.create")}
          </Button>
        </div>
      ) : null}
      <Table
        caption={t("templates.title")}
        rows={templates ?? []}
        rowKey={(template) => template.id}
        loading={loading}
        empty={
          <EmptyState
            icon={LayoutTemplate}
            title={t("templates.emptyTitle")}
            description={t("templates.emptyDescription")}
            {...(canManage
              ? {
                  action: (
                    <Button variant="secondary" icon={Plus} onClick={() => setEditing("new")}>
                      {t("templates.create")}
                    </Button>
                  ),
                }
              : {})}
          />
        }
        columns={[
          {
            key: "name",
            header: t("templates.name"),
            cell: (template) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium" title={template.name}>
                  {template.name}
                </span>
                <span className="truncate text-sm text-text-muted" title={template.description}>
                  {template.description}
                </span>
              </span>
            ),
          },
          {
            key: "category",
            header: t("templates.category"),
            hideBelow: "sm",
            cell: (template) => (
              <Badge variant="neutral">{t(`templates.categories.${template.category}`)}</Badge>
            ),
          },
          {
            key: "fields",
            header: t("templates.fields"),
            hideBelow: "md",
            align: "end",
            cell: (template) => <span className="tabular-nums">{template.fields.length}</span>,
          },
          {
            key: "updated",
            header: t("templates.updated"),
            hideBelow: "md",
            cell: (template) => (template.updatedAt ? format.date(template.updatedAt) : ""),
          },
          {
            key: "actions",
            header: <span className="sr-only">{t("templates.actions")}</span>,
            align: "end",
            cell: (template) =>
              canManage ? (
                <Menu
                  trigger={
                    <IconButton label={t("templates.actionsFor", { name: template.name })} icon={Pencil} />
                  }
                  items={[
                    { label: t("templates.edit"), icon: Pencil, onSelect: () => setEditing(template) },
                    { type: "separator" },
                    {
                      label: t("templates.delete"),
                      icon: Trash2,
                      danger: true,
                      onSelect: () => setDeleting(template),
                    },
                  ]}
                />
              ) : null,
          },
        ]}
      />
      <TemplateDialog
        template={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={async (input) => {
          if (editing === "new") await onCreate(input);
          else if (editing) await onUpdate(editing.id, input);
          toast({ title: t("templates.savedTemplate", { name: input.name }), variant: "success" });
          setEditing(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t("templates.deleteTitle", { name: deleting?.name ?? "" })}
        description={t("templates.deleteDescription")}
        confirmLabel={t("templates.delete")}
        cancelLabel={t("templates.keep")}
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await onDelete(deleting.id);
            toast({ title: t("templates.deleted", { name: deleting.name }), variant: "success" });
          } catch (failure) {
            toast({
              title: t("templates.deleteFailed"),
              description: problemMessage(t, failure),
              variant: "error",
            });
          }
        }}
      />
    </div>
  );
}

function TemplateDialog({
  template,
  onOpenChange,
  onSave,
}: {
  template: PageTemplate | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSave: (input: TemplateInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={template !== null}
      onOpenChange={onOpenChange}
      title={template === "new" ? t("templates.createTitle") : t("templates.editTitle")}
      size="lg"
    >
      {template ? (
        <TemplateForm
          key={template === "new" ? "new" : template.id}
          template={template === "new" ? null : template}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
        />
      ) : null}
    </Dialog>
  );
}

interface FieldDraft {
  key: string;
  label: string;
  type: TemplateField["type"];
  required: boolean;
  options: string;
}

function toDraft(field: TemplateField): FieldDraft {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    options: (field.options ?? []).join("\n"),
  };
}

function TemplateForm({
  template,
  onCancel,
  onSave,
}: {
  template: PageTemplate | null;
  onCancel: () => void;
  onSave: (input: TemplateInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [category, setCategory] = useState<TemplateCategory>(template?.category ?? "knowledge");
  const [title, setTitle] = useState(template?.title ?? "");
  const [fields, setFields] = useState<FieldDraft[]>(template?.fields.map(toDraft) ?? []);
  const [document, setDocument] = useState<unknown>(template?.document ?? EMPTY_DOCUMENT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {};
    if (!name.trim() || name.trim().length > 100) found.name = t("templates.nameInvalid");
    if (!title.trim() || title.trim().length > 255) found.title = t("templates.titleInvalid");
    const keys = new Set<string>();
    fields.forEach((field, index) => {
      if (!KEY_PATTERN.test(field.key) || keys.has(field.key))
        found[`key${index}`] = t("templates.keyInvalid");
      keys.add(field.key);
      if (!field.label.trim()) found[`label${index}`] = t("templates.labelRequired");
      if (
        field.type === "choice" &&
        field.options.split("\n").filter((option) => option.trim()).length === 0
      ) {
        found[`options${index}`] = t("templates.optionsRequired");
      }
    });
    for (const match of title.matchAll(/\{([^}]*)\}/g)) {
      if (!keys.has(match[1] ?? "")) found.title = t("templates.unknownTitleField", { key: match[1] ?? "" });
    }
    return found;
  };

  const save = async () => {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        category,
        title: title.trim(),
        fields: fields.map((field) => ({
          key: field.key,
          label: field.label.trim(),
          type: field.type,
          required: field.required,
          ...(field.type === "choice"
            ? {
                options: field.options
                  .split("\n")
                  .map((option) => option.trim())
                  .filter(Boolean),
              }
            : {}),
        })),
        document,
      });
    } catch (failure) {
      toast({ title: t("templates.saveFailed"), description: problemMessage(t, failure), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const update = (index: number, change: Partial<FieldDraft>) =>
    setFields((current) =>
      current.map((field, position) => (position === index ? { ...field, ...change } : field)),
    );

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("templates.name")} error={errors.name} required>
          <Input
            value={name}
            aria-invalid={errors.name ? true : undefined}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t("templates.category")}>
          <Select
            value={category}
            onValueChange={(value) => setCategory(value as TemplateCategory)}
            options={TEMPLATE_CATEGORIES.map((value) => ({
              value,
              label: t(`templates.categories.${value}`),
            }))}
          />
        </Field>
      </div>
      <Field label={t("templates.description")} hint={t("templates.descriptionHint")}>
        <Textarea
          value={description}
          rows={2}
          maxLength={300}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field
        label={t("templates.pageTitle")}
        hint={t("templates.pageTitleHint")}
        error={errors.title}
        required
      >
        <Input
          value={title}
          placeholder={t("templates.pageTitleExample")}
          aria-invalid={errors.title ? true : undefined}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-medium">{t("templates.fields")}</legend>
        <p className="text-sm text-text-muted">{t("templates.fieldsHint")}</p>
        {fields.map((field, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity while their key is being typed
            key={index}
            className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[1fr_1fr_auto_auto]"
          >
            <Field label={t("templates.fieldLabel")} error={errors[`label${index}`]}>
              <Input
                value={field.label}
                aria-invalid={errors[`label${index}`] ? true : undefined}
                onChange={(event) => update(index, { label: event.target.value })}
              />
            </Field>
            <Field
              label={t("templates.fieldKey")}
              hint={t("templates.fieldKeyHint")}
              error={errors[`key${index}`]}
            >
              <Input
                value={field.key}
                aria-invalid={errors[`key${index}`] ? true : undefined}
                onChange={(event) => update(index, { key: event.target.value.replace(/[^a-zA-Z0-9]/g, "") })}
              />
            </Field>
            <Field label={t("templates.fieldType")}>
              <Select
                value={field.type}
                onValueChange={(value) => update(index, { type: value as FieldDraft["type"] })}
                options={FIELD_TYPES.map((type) => ({
                  value: type,
                  label: t(`templates.fieldTypes.${type}`),
                }))}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Checkbox
                label={t("templates.required")}
                checked={field.required}
                onCheckedChange={(checked) => update(index, { required: checked === true })}
              />
              <IconButton
                label={t("templates.removeField", { name: field.label || field.key })}
                icon={X}
                onClick={() => setFields((current) => current.filter((_, position) => position !== index))}
              />
            </div>
            {field.type === "choice" ? (
              <div className="md:col-span-4">
                <Field
                  label={t("templates.options")}
                  hint={t("templates.optionsHint")}
                  error={errors[`options${index}`]}
                >
                  <Textarea
                    value={field.options}
                    rows={3}
                    aria-invalid={errors[`options${index}`] ? true : undefined}
                    onChange={(event) => update(index, { options: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            icon={Plus}
            onClick={() =>
              setFields((current) => [
                ...current,
                { key: `field${current.length + 1}`, label: "", type: "text", required: false, options: "" },
              ])
            }
          >
            {t("templates.addField")}
          </Button>
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <span className="font-medium">{t("templates.content")}</span>
        <p className="text-sm text-text-muted">{t("templates.contentHint")}</p>
        <Suspense fallback={<Skeleton className="h-field w-full" />}>
          <TemplateContentEditor
            initial={document}
            label={t("templates.content")}
            fields={fields
              .filter((field) => KEY_PATTERN.test(field.key))
              .map((field) => ({ key: field.key, label: field.label }))}
            onChange={setDocument}
          />
        </Suspense>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {template ? t("templates.saveChanges") : t("templates.createAction")}
        </Button>
      </div>
    </form>
  );
}
