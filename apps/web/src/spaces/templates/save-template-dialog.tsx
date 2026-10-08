import {
  Button,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  Select,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { contentKeys } from "../content-queries.js";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "./template-categories.js";

export function SaveTemplateDialog({
  spaceId,
  page,
  open,
  onOpenChange,
}: {
  spaceId: string;
  page: { id: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("templates.saveTitle")} size="sm">
      {open ? <SaveTemplateForm spaceId={spaceId} page={page} onDone={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

function SaveTemplateForm({
  spaceId,
  page,
  onDone,
}: {
  spaceId: string;
  page: { id: string; title: string };
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(page.title);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TemplateCategory>("knowledge");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (name.trim().length === 0 || name.trim().length > 100) {
      setError(t("templates.nameInvalid"));
      focusFirstInvalidSoon();
      return;
    }
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/templates/from-page", {
          params: { path: { spaceId } },
          body: { pageId: page.id, name: name.trim(), description: description.trim(), category },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: contentKeys.gallery(spaceId) });
      await queryClient.invalidateQueries({ queryKey: contentKeys.spaceTemplates(spaceId) });
      toast({ title: t("templates.saved", { name: name.trim() }), variant: "success" });
      onDone();
    } catch (failure) {
      toast({ title: t("templates.saveFailed"), description: problemMessage(t, failure), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-text-muted">{t("templates.saveDescription")}</p>
      <Field label={t("templates.name")} error={error ?? undefined} required>
        <Input
          value={name}
          maxLength={200}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setName(event.target.value);
            if (error && event.target.value.trim()) setError(null);
          }}
        />
      </Field>
      <Field label={t("templates.description")} hint={t("templates.descriptionHint")}>
        <Textarea
          value={description}
          rows={2}
          maxLength={300}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field label={t("templates.category")}>
        <Select
          value={category}
          onValueChange={(value) => setCategory(value as TemplateCategory)}
          options={TEMPLATE_CATEGORIES.map((value) => ({ value, label: t(`templates.categories.${value}`) }))}
        />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {t("templates.saveAction")}
        </Button>
      </div>
    </form>
  );
}
