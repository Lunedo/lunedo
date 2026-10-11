import {
  MAX_TEMPLATE_BUTTON_LABEL,
  MAX_TEMPLATE_TITLE_PATTERN,
  titlePatternFields,
} from "@pagehall/editor-schema";
import {
  Button,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  Select,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { FilePlus } from "lucide-react";
import { type KeyboardEvent, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { galleryQuery, type PageTemplate } from "../spaces/content-queries.js";
import { itemHref } from "../spaces/item-paths.js";
import { SpaceContext } from "../spaces/space-context.js";
import { FieldInput, today } from "../spaces/templates/template-gallery.js";
import { useEditable, useOpenPath, usePageContext } from "./context.js";

export interface TemplateButtonSettings {
  templateId: string;
  label: string;
  title: string;
}

export function templateButtonFromAttrs(attrs: Record<string, unknown>): TemplateButtonSettings {
  return {
    templateId: typeof attrs.templateId === "string" ? attrs.templateId : "",
    label: typeof attrs.label === "string" ? attrs.label : "",
    title: typeof attrs.title === "string" ? attrs.title : "",
  };
}

function CreateDialog({
  template,
  button,
  spaceId,
  spaceKey,
  parentId,
  onClose,
}: {
  template: PageTemplate;
  button: TemplateButtonSettings;
  spaceId: string;
  spaceKey: string;
  parentId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const open = useOpenPath();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      template.fields.filter((field) => field.type === "date").map((field) => [field.key, today()]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const create = async () => {
    const found: Record<string, string> = {};
    for (const field of template.fields) {
      if (field.required && !(values[field.key] ?? "").trim()) {
        found[field.key] = t("gallery.required", { label: field.label });
      }
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    setCreating(true);
    try {
      const created = await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/items", {
          params: { path: { spaceId } },
          body: {
            kind: "page",
            title: "",
            parentId,
            template: {
              id: template.id,
              values: Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())),
              ...(button.title ? { titlePattern: button.title } : {}),
            },
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["spaces", spaceId, "children"] });
      onClose();
      const href = itemHref(created, spaceKey);
      if (href) open(href, { edit: true });
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
      {template.fields.length === 0 ? (
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
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={creating}>
          {t("editor.templateButton.create")}
        </Button>
      </div>
    </form>
  );
}

export function TemplateButton({
  button,
  parentId,
  editing = false,
}: {
  button: TemplateButtonSettings;
  parentId: string | null;
  editing?: boolean;
}) {
  const { t } = useTranslation();
  const space = useContext(SpaceContext);
  const page = usePageContext();
  const spaceId = page?.spaceId ?? space?.space.id ?? null;
  const spaceKey = page?.spaceKey ?? space?.space.key ?? "";
  const canCreate = editing || (space?.canEdit ?? false);
  const gallery = useQuery({ ...galleryQuery(spaceId ?? ""), enabled: spaceId !== null && canCreate });
  const [open, setOpen] = useState(false);
  const template = gallery.data?.find((candidate) => candidate.id === button.templateId) ?? null;
  const label = button.label.trim() || template?.name || t("editor.templateButton.defaultLabel");
  if (!spaceId || !canCreate) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button variant="secondary" icon={FilePlus} disabled>
          {label}
        </Button>
        <p className="text-sm text-text-muted">{t("editor.templateButton.editorsOnly")}</p>
      </div>
    );
  }
  if (gallery.isPending) return <Skeleton className="h-control-md w-field" />;
  if (gallery.isError) {
    return (
      <LoadError
        what={t("editor.templateButton.loadFailed")}
        error={gallery.error}
        onRetry={gallery.refetch}
      />
    );
  }
  if (!template) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button variant="secondary" icon={FilePlus} disabled>
          {label}
        </Button>
        <p className="text-sm text-text-muted">{t("editor.templateButton.missing")}</p>
      </div>
    );
  }
  return (
    <>
      <Button variant="secondary" icon={FilePlus} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("editor.templateButton.dialogTitle", { name: template.name })}
        description={t("editor.templateButton.dialogDescription")}
      >
        {open ? (
          <CreateDialog
            template={template}
            button={button}
            spaceId={spaceId}
            spaceKey={spaceKey}
            parentId={parentId}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function CommitInput({
  label,
  hint,
  value,
  max,
  validate,
  onCommit,
}: {
  label: string;
  hint: string;
  value: string;
  max: number;
  validate?: (value: string) => string | null;
  onCommit: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = (text: string) =>
    text.length > max ? t("editor.templateButton.tooLong", { count: max }) : (validate?.(text) ?? null);
  const commit = () => {
    if (draft === null) return;
    const text = draft.replace(/\s+/g, " ").trim();
    const problem = check(text);
    setError(problem);
    if (problem) return;
    setDraft(null);
    if (text !== value) onCommit(text);
  };
  return (
    <Field label={label} hint={hint} error={error ?? undefined}>
      <Input
        value={draft ?? value}
        invalid={error !== null}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error !== null && !check(event.target.value.trim())) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </Field>
  );
}

export function TemplateButtonSettingsForm({
  button,
  spaceId,
  onChange,
}: {
  button: TemplateButtonSettings;
  spaceId: string | null;
  onChange: (changes: Partial<TemplateButtonSettings>) => void;
}) {
  const { t } = useTranslation();
  const gallery = useQuery({ ...galleryQuery(spaceId ?? ""), enabled: spaceId !== null });
  const templates = (gallery.data ?? []).filter((template) => !template.series);
  const template = templates.find((candidate) => candidate.id === button.templateId) ?? null;
  const keys = template?.fields.map((field) => field.key) ?? [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("editor.templateButton.template")}>
        {gallery.isError ? (
          <LoadError
            what={t("editor.templateButton.loadFailed")}
            error={gallery.error}
            onRetry={gallery.refetch}
          />
        ) : (
          <Select
            value={button.templateId || undefined}
            placeholder={t("editor.templateButton.chooseTemplate")}
            onValueChange={(templateId) => onChange({ templateId })}
            options={[
              ...(template || !button.templateId
                ? []
                : [{ value: button.templateId, label: t("editor.templateButton.unavailable") }]),
              ...templates.map((entry) => ({
                value: entry.id,
                label:
                  entry.level === "builtIn"
                    ? entry.name
                    : t("editor.templateButton.ownTemplate", { name: entry.name }),
              })),
            ]}
          />
        )}
      </Field>
      <CommitInput
        label={t("editor.templateButton.label")}
        hint={t("editor.templateButton.labelHint")}
        value={button.label}
        max={MAX_TEMPLATE_BUTTON_LABEL}
        onCommit={(label) => onChange({ label })}
      />
      <div className="sm:col-span-2">
        <CommitInput
          label={t("editor.templateButton.title")}
          hint={
            keys.length > 0
              ? t("editor.templateButton.titleHint", { fields: keys.map((key) => `{${key}}`).join(", ") })
              : t("editor.templateButton.titleHintNoFields")
          }
          value={button.title}
          max={MAX_TEMPLATE_TITLE_PATTERN}
          validate={(text) => {
            const unknown = titlePatternFields(text).filter((key) => !keys.includes(key));
            return unknown.length > 0
              ? t("editor.templateButton.unknownFields", {
                  count: unknown.length,
                  fields: unknown.map((key) => `{${key}}`).join(", "),
                })
              : null;
          }}
          onCommit={(title) => onChange({ title })}
        />
      </div>
    </div>
  );
}

export function TemplateButtonView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const page = usePageContext();
  const button = templateButtonFromAttrs(node.attrs);
  return (
    <NodeViewWrapper
      className={`ph-template-button-block flex flex-col gap-3${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="templateButton"
    >
      {editable ? (
        <TemplateButtonSettingsForm
          button={button}
          spaceId={page?.spaceId ?? null}
          onChange={(changes) => updateAttributes(changes)}
        />
      ) : null}
      <div>
        <TemplateButton button={button} parentId={page?.pageId ?? null} editing={editable} />
      </div>
    </NodeViewWrapper>
  );
}
