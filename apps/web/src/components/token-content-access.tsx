import { Combobox, type ComboboxItem, Field, SegmentedControl } from "@lunedo/ui";
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ApiToken } from "../api/account-queries.js";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
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

export function useSpaceNames(spaceIds: readonly string[]): ReadonlyMap<string, string> {
  const spaces = useQueries({
    queries: [...new Set(spaceIds)].map((spaceId) => ({
      queryKey: ["spaces", spaceId, "name"],
      queryFn: () => request(() => api.GET("/api/v1/spaces/{spaceId}", { params: { path: { spaceId } } })),
      retry: false,
    })),
  });
  return new Map(spaces.flatMap((entry) => (entry.data ? [[entry.data.id, entry.data.name] as const] : [])));
}

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
  names: ReadonlyMap<string, string> = new Map(),
): string | null {
  if (!token.scopes.organization?.spaces) return null;
  const level = translateKey(t, `tokens.content.levels.${token.contentLevel}`);
  if (!token.knowledgeBaseIds) return level;
  const named = token.knowledgeBaseIds.flatMap((id) => {
    const name = names.get(id);
    return name ? [name] : [];
  });
  return named.length === token.knowledgeBaseIds.length && named.length > 0
    ? t("tokens.content.summaryNamed", { level, names: named.join(", ") })
    : t("tokens.content.summaryLimited", { level, count: token.knowledgeBaseIds.length });
}

export function ContentAccessFields({
  value,
  onChange,
  organizationId,
  error,
  allowNone = true,
  readOnly = false,
}: {
  value: ContentAccess;
  onChange: (next: ContentAccess) => void;
  organizationId: string | null;
  error?: string | undefined;
  allowNone?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const choices = allowNone ? CONTENT_CHOICES : CONTENT_CHOICES.filter((choice) => choice !== "none");
  const reach = t("tokens.content.reach");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
        <span className="min-w-0">{t("tokens.content.areas")}</span>
        <SegmentedControl
          label={t("tokens.content.title")}
          value={value.choice}
          onValueChange={(choice) => onChange({ ...value, choice: choice as ContentChoice })}
          options={choices.map((choice) => ({
            value: choice,
            label: translateKey(t, `tokens.content.short.${choice}`),
            ...(readOnly && (choice === "draft" || choice === "publish")
              ? { disabled: true, disabledReason: t("tokens.content.readOnlyReason") }
              : {}),
          }))}
        />
      </div>
      <p className="text-sm text-text-muted">
        {translateKey(t, `tokens.content.descriptions.${value.choice}`)}
      </p>
      {value.choice !== "none" && organizationId ? (
        <div className="flex flex-col gap-2 pt-2">
          <h5 className="font-medium">{reach}</h5>
          <SegmentedControl
            label={reach}
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
        </div>
      ) : null}
    </div>
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
