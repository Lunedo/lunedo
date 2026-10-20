import { Button, Combobox, type ComboboxItem, Dialog, Field, Notice, RadioGroup } from "@pagehall/ui";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiToken } from "../api/account-queries.js";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { knowledgeBaseLoader } from "./pickers.js";

export const CONTENT_CHOICES = ["none", "read", "draft", "publish"] as const;
export type ContentChoice = (typeof CONTENT_CHOICES)[number];
export type ContentLevel = Exclude<ContentChoice, "none">;

export interface ContentAccess {
  choice: ContentChoice;
  limited: boolean;
  knowledgeBases: ComboboxItem[];
}

export const NO_CONTENT_ACCESS: ContentAccess = { choice: "none", limited: false, knowledgeBases: [] };

export function contentAccessOf(
  token: Pick<ApiToken, "scopes" | "contentLevel" | "knowledgeBaseIds">,
  names: ReadonlyMap<string, string> = new Map(),
): ContentAccess {
  const spaces = token.scopes.organization?.spaces;
  return {
    choice: spaces ? token.contentLevel : "none",
    limited: token.knowledgeBaseIds !== null,
    knowledgeBases: (token.knowledgeBaseIds ?? []).map((id) => ({ value: id, label: names.get(id) ?? id })),
  };
}

export function contentSummary(
  t: Parameters<typeof translateKey>[0],
  token: Pick<ApiToken, "scopes" | "contentLevel" | "knowledgeBaseIds">,
): string | null {
  if (!token.scopes.organization?.spaces) return null;
  const level = translateKey(t, `tokens.content.levels.${token.contentLevel}`);
  return token.knowledgeBaseIds
    ? t("tokens.content.summaryLimited", { level, count: token.knowledgeBaseIds.length })
    : level;
}

export function ContentAccessFields({
  value,
  onChange,
  organizationId,
  error,
  allowNone = true,
}: {
  value: ContentAccess;
  onChange: (next: ContentAccess) => void;
  organizationId: string | null;
  error?: string | undefined;
  allowNone?: boolean;
}) {
  const { t } = useTranslation();
  const choices = allowNone ? CONTENT_CHOICES : CONTENT_CHOICES.filter((choice) => choice !== "none");
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 font-medium">{t("tokens.content.title")}</legend>
      <RadioGroup
        label={t("tokens.content.title")}
        value={value.choice}
        onValueChange={(choice) => onChange({ ...value, choice: choice as ContentChoice })}
        options={choices.map((choice) => ({
          value: choice,
          label: translateKey(t, `tokens.content.levels.${choice}`),
          description: translateKey(t, `tokens.content.descriptions.${choice}`),
        }))}
      />
      {value.choice !== "none" && organizationId ? (
        <>
          <RadioGroup
            label={t("tokens.content.reach")}
            value={value.limited ? "selected" : "all"}
            onValueChange={(next) => onChange({ ...value, limited: next === "selected" })}
            options={[
              { value: "all", label: t("tokens.content.allContent") },
              { value: "selected", label: t("tokens.content.selectedKnowledgeBases") },
            ]}
          />
          {value.limited ? (
            <Field label={t("tokens.content.knowledgeBases")} error={error}>
              <Combobox
                multiple
                aria-label={t("tokens.content.knowledgeBases")}
                placeholder={t("tokens.content.searchKnowledgeBases")}
                load={knowledgeBaseLoader(organizationId)}
                value={value.knowledgeBases.map((item) => item.value)}
                selectedItems={value.knowledgeBases}
                invalid={error !== undefined}
                onValueChange={(_ids, items) => onChange({ ...value, knowledgeBases: items })}
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}

export function contentRequest(access: ContentAccess): {
  spaces: "view" | "manage" | null;
  contentLevel?: ContentLevel;
  knowledgeBaseIds?: string[];
} {
  if (access.choice === "none") return { spaces: null };
  return {
    spaces: access.choice === "read" ? "view" : "manage",
    contentLevel: access.choice,
    ...(access.limited ? { knowledgeBaseIds: access.knowledgeBases.map((item) => item.value) } : {}),
  };
}

export function ContentAccessDialog({
  token,
  organizationId,
  onOpenChange,
  onSave,
}: {
  token: (Pick<ApiToken, "scopes" | "contentLevel" | "knowledgeBaseIds"> & { name: string }) | null;
  organizationId: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (change: { contentLevel: ContentLevel; knowledgeBaseIds: string[] | null }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<ContentAccess | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const spaces = useQueries({
    queries: (token?.knowledgeBaseIds ?? []).map((spaceId) => ({
      queryKey: ["spaces", spaceId, "name"],
      queryFn: () => request(() => api.GET("/api/v1/spaces/{spaceId}", { params: { path: { spaceId } } })),
      retry: false,
    })),
  });
  const names = new Map(
    spaces.flatMap((entry) => (entry.data ? [[entry.data.id, entry.data.name] as const] : [])),
  );
  const current = access ?? (token ? contentAccessOf(token, names) : NO_CONTENT_ACCESS);
  const manages = token?.scopes.organization?.spaces === "manage";
  const close = (open: boolean) => {
    if (!open) {
      setAccess(null);
      setFieldError(undefined);
      setError(null);
    }
    onOpenChange(open);
  };
  const save = async () => {
    setError(null);
    if (current.choice === "none") return;
    if (current.limited && current.knowledgeBases.length === 0) {
      setFieldError(t("tokens.content.knowledgeBasesRequired"));
      return;
    }
    setFieldError(undefined);
    setSaving(true);
    try {
      await onSave({
        contentLevel: current.choice,
        knowledgeBaseIds: current.limited ? current.knowledgeBases.map((item) => item.value) : null,
      });
      close(false);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={token !== null}
      onOpenChange={close}
      title={t("tokens.content.changeTitle", { name: token?.name ?? "" })}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <Notice variant="danger" title={t("tokens.content.changeFailed")}>
            {error}
          </Notice>
        ) : null}
        {manages ? null : <Notice variant="info">{t("tokens.content.readOnlyScope")}</Notice>}
        <ContentAccessFields
          value={current}
          onChange={setAccess}
          organizationId={organizationId}
          error={fieldError}
          allowNone={false}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => close(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {t("tokens.content.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
