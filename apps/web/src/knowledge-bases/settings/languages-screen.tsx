import { contentLanguages, OTHER_CONTENT_LANGUAGE } from "@pagehall/shared";
import {
  Badge,
  Combobox,
  List,
  ListRow,
  Notice,
  type SaveState,
  SaveStatus,
  Section,
  Select,
  SettingRow,
  Skeleton,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Languages } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { contentLanguageLabel } from "../../search/content-language.js";
import { SpaceSettingsPage } from "../../spaces/settings/space-settings-page.js";
import { useSpace } from "../../spaces/space-context.js";
import { knowledgeBaseKeys, type LanguageSettings, languagesQuery } from "../queries.js";

const SEARCH_UPDATE_REFRESH_MS = 3000;

type Field = "defaultLanguage" | "languages";
type Change = { defaultLanguage?: string; languages?: string[] };

export function LanguagesScreen() {
  const { t, i18n } = useTranslation();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const settings = useQuery({
    ...languagesQuery(space.id),
    throwOnError: false,
    refetchInterval: (query) => (query.state.data?.searchUpdate ? SEARCH_UPDATE_REFRESH_MS : false),
  });
  const editable = space.role === "admin" && !space.archived;
  const [states, setStates] = useState<Partial<Record<Field, SaveState>>>({});
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const label = (language: string) => contentLanguageLabel(t, language, i18n.language);
  const items = useMemo(
    () =>
      contentLanguages
        .filter((language) => language !== OTHER_CONTENT_LANGUAGE)
        .map((language) => ({
          value: language,
          label: contentLanguageLabel(t, language, i18n.language),
          keywords: [language, contentLanguageLabel(t, language, "en")],
        }))
        .sort((left, right) => left.label.localeCompare(right.label, i18n.language)),
    [t, i18n.language],
  );

  const save = async (field: Field, change: Change) => {
    setStates((current) => ({ ...current, [field]: "saving" }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    try {
      const next = await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/languages", {
          params: { path: { spaceId: space.id } },
          body: change,
        }),
      );
      queryClient.setQueryData(knowledgeBaseKeys.languages(space.id), next);
      await queryClient.invalidateQueries({ queryKey: knowledgeBaseKeys.all(space.id) });
      setStates((current) => ({ ...current, [field]: "saved" }));
    } catch (failure) {
      setErrors((current) => ({ ...current, [field]: problemMessage(t, failure) }));
      setStates((current) => ({ ...current, [field]: "error" }));
    }
  };
  const status = (field: Field, retry: Change) => {
    const error = errors[field];
    return (
      <SaveStatus
        state={states[field] ?? "idle"}
        {...(error ? { error, onRetry: () => void save(field, retry) } : {})}
      />
    );
  };

  const value: LanguageSettings | undefined = settings.data;
  return (
    <SpaceSettingsPage
      tab="languages"
      title={t("knowledgeBase.languages.title")}
      description={t("knowledgeBase.languages.description")}
      icon={Languages}
    >
      <div className="flex flex-col gap-6">
        {settings.isPending ? <Skeleton className="h-field w-full" /> : null}
        {settings.isError ? (
          <LoadError
            what={t("knowledgeBase.languages.loadFailed")}
            error={settings.error}
            onRetry={() => settings.refetch()}
          />
        ) : null}
        {value ? (
          <>
            {editable ? null : (
              <Notice variant="info">
                {t(
                  space.archived ? "knowledgeBase.languages.archived" : "knowledgeBase.languages.adminsOnly",
                )}
              </Notice>
            )}
            {value.searchUpdate ? (
              <Notice variant="info">
                <div className="flex flex-col gap-2">
                  <p>
                    {t("knowledgeBase.languages.searchUpdate", {
                      count: value.searchUpdate.remaining,
                      total: value.searchUpdate.total,
                    })}
                  </p>
                  <div
                    role="progressbar"
                    aria-label={t("knowledgeBase.languages.searchUpdateLabel")}
                    aria-valuemin={0}
                    aria-valuemax={value.searchUpdate.total}
                    aria-valuenow={value.searchUpdate.total - value.searchUpdate.remaining}
                    className="h-2 overflow-hidden rounded-full bg-surface-sunken"
                  >
                    <div
                      className="h-full bg-accent transition-[width] motion-reduce:transition-none"
                      style={{
                        width: `${Math.round(((value.searchUpdate.total - value.searchUpdate.remaining) / value.searchUpdate.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </Notice>
            ) : null}
            <Section title={t("knowledgeBase.languages.section")} icon={Languages}>
              <div className="flex flex-col divide-y divide-border">
                <SettingRow
                  label={t("knowledgeBase.languages.default")}
                  description={t("knowledgeBase.languages.defaultDescription")}
                  control={
                    <Select
                      aria-label={t("knowledgeBase.languages.default")}
                      className="w-full"
                      disabled={!editable}
                      value={value.defaultLanguage}
                      options={value.languages.map((language) => ({
                        value: language,
                        label: label(language),
                      }))}
                      onValueChange={(next) => void save("defaultLanguage", { defaultLanguage: next })}
                    />
                  }
                  status={status("defaultLanguage", { defaultLanguage: value.defaultLanguage })}
                />
                <SettingRow
                  label={t("knowledgeBase.languages.enabled")}
                  description={t("knowledgeBase.languages.enabledDescription", {
                    language: label(value.defaultLanguage),
                  })}
                  control={
                    <Combobox
                      multiple
                      aria-label={t("knowledgeBase.languages.enabled")}
                      placeholder={t("knowledgeBase.languages.add")}
                      disabled={!editable}
                      items={items}
                      value={value.languages}
                      onValueChange={(next) => {
                        const languages = next.includes(value.defaultLanguage)
                          ? next
                          : [value.defaultLanguage, ...next];
                        void save("languages", { languages });
                      }}
                    />
                  }
                  status={status("languages", { languages: value.languages })}
                />
              </div>
            </Section>
            {value.progress.length > 0 ? (
              <Section title={t("knowledgeBase.languages.progress")} icon={Languages}>
                <List label={t("knowledgeBase.languages.progress")}>
                  {value.progress.map((entry) => (
                    <ListRow
                      key={entry.language}
                      title={label(entry.language)}
                      description={t("knowledgeBase.languages.translated", {
                        count: entry.translated,
                        total: value.articles,
                      })}
                      actions={
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge variant={entry.missing > 0 ? "warning" : "neutral"}>
                            {t("knowledgeBase.languages.missing", { count: entry.missing })}
                          </Badge>
                          <Badge variant={entry.outdated > 0 ? "warning" : "neutral"}>
                            {t("knowledgeBase.languages.outdated", { count: entry.outdated })}
                          </Badge>
                        </span>
                      }
                    />
                  ))}
                </List>
              </Section>
            ) : (
              <p className="text-sm text-text-muted">{t("knowledgeBase.languages.single")}</p>
            )}
          </>
        ) : null}
      </div>
    </SpaceSettingsPage>
  );
}
