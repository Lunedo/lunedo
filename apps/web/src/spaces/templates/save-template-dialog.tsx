import {
  Button,
  Checkbox,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  Select,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { isApiError, request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { contentKeys } from "../content-queries.js";
import { TEMPLATE_CATEGORIES, type TemplateCategory } from "./template-categories.js";

export function SaveTemplateDialog({
  spaceId,
  spaceName,
  page,
  open,
  onOpenChange,
}: {
  spaceId: string;
  spaceName: string;
  page: { id: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("templates.saveTitle")} size="sm">
      {open ? (
        <SaveTemplateForm
          spaceId={spaceId}
          spaceName={spaceName}
          page={page}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function SaveTemplateForm({
  spaceId,
  spaceName,
  page,
  onDone,
}: {
  spaceId: string;
  spaceName: string;
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
  const [confirmed, setConfirmed] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const files = useQuery({
    queryKey: ["templates", "from-page", page.id],
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/templates/from-page/files", {
          params: { path: { spaceId }, query: { pageId: page.id } },
        }),
      ),
    gcTime: 0,
  });

  const restricted = files.data?.restricted ?? false;
  const save = async () => {
    const nameInvalid = name.trim().length === 0 || name.trim().length > 100;
    setError(nameInvalid ? t("templates.nameInvalid") : null);
    const unconfirmed = restricted && !confirmed;
    setConfirmError(unconfirmed ? t("templates.restrictedRequired") : null);
    if (nameInvalid || unconfirmed) {
      focusFirstInvalidSoon();
      return;
    }
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/templates/from-page", {
          params: { path: { spaceId } },
          body: {
            pageId: page.id,
            name: name.trim(),
            description: description.trim(),
            category,
            confirmRestricted: restricted && confirmed,
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: contentKeys.gallery(spaceId) });
      await queryClient.invalidateQueries({ queryKey: contentKeys.spaceTemplates(spaceId) });
      toast({ title: t("templates.saved", { name: name.trim() }), variant: "success" });
      onDone();
    } catch (failure) {
      if (isApiError(failure, "templateFromRestrictedPage")) {
        await files.refetch();
        setConfirmed(false);
        setConfirmError(t("templates.restrictedRequired"));
        focusFirstInvalidSoon();
        return;
      }
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
      {files.data?.restricted ? (
        <Notice variant="warning" title={t("templates.restrictedTitle")}>
          <div className="flex flex-col gap-3">
            <p>
              {t("templates.restrictedAudience", { space: spaceName })}{" "}
              {t("templates.saveRestricted", { count: files.data.files })}
            </p>
            <Checkbox
              checked={confirmed}
              onCheckedChange={(checked) => {
                setConfirmed(checked);
                if (checked) setConfirmError(null);
              }}
              label={t("templates.restrictedConfirm", { space: spaceName })}
              {...(confirmError ? { error: confirmError } : {})}
            />
          </div>
        </Notice>
      ) : files.data && files.data.files > 0 ? (
        <Notice variant="info">{t("templates.saveFiles", { count: files.data.files })}</Notice>
      ) : null}
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
