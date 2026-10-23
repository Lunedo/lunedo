import { type SaveState, SaveStatus, Section, Skeleton, Switch } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useSpace } from "../../spaces/space-context.js";
import { articleTypeIcon, articleTypeLabel } from "../article-types.js";
import { NamedIcon } from "../icons.js";
import { knowledgeBaseKeys, type TemplateSections, templateSectionsQuery } from "../queries.js";

export function ArticleTemplateSections() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const templates = useQuery({ ...templateSectionsQuery(space.id), throwOnError: false });
  return (
    <div className="flex flex-col gap-8">
      {templates.isPending ? <Skeleton className="h-field w-full" /> : null}
      {templates.isError ? (
        <LoadError
          what={t("knowledgeBase.templates.loadFailed")}
          error={templates.error}
          onRetry={() => templates.refetch()}
        />
      ) : null}
      {templates.data?.map((template) => (
        <TemplateCard key={template.templateId} template={template} />
      ))}
      <p className="text-sm text-text-muted">{t("knowledgeBase.templates.hint")}</p>
    </div>
  );
}

function TemplateCard({ template }: { template: TemplateSections }) {
  const { t } = useTranslation();
  const Icon = articleTypeIcon(template.articleType);
  return (
    <Section title={template.name} icon={Icon}>
      <div className="flex flex-col gap-2 p-4">
        <p className="text-sm text-text-muted">
          {articleTypeLabel(t, template.articleType)}
          {template.builtIn ? ` · ${t("knowledgeBase.templates.builtIn")}` : ""}
        </p>
        {template.sections.length === 0 ? (
          <p className="text-sm text-text-muted">{t("knowledgeBase.templates.noSections")}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {template.sections.map((section) => (
              <SectionRow key={section.key} templateId={template.templateId} section={section} />
            ))}
          </ol>
        )}
      </div>
    </Section>
  );
}

function SectionRow({
  templateId,
  section,
}: {
  templateId: string;
  section: TemplateSections["sections"][number];
}) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const editable = space.role === "admin" && !space.archived;
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const change = async (required: boolean) => {
    setState("saving");
    setError(null);
    try {
      const next = await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/knowledge-base/required-sections", {
          params: { path: { spaceId: space.id } },
          body: { templateId, sectionKey: section.key, required },
        }),
      );
      queryClient.setQueryData(knowledgeBaseKeys.templates(space.id), next);
      setState("saved");
    } catch (failure) {
      setError(problemMessage(t, failure));
      setState("error");
    }
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <NamedIcon name={section.icon} className="size-icon shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate" title={section.title}>
        {section.title}
      </span>
      <Switch
        checked={section.required}
        label={t("knowledgeBase.templates.requiredOf", { section: section.title })}
        disabled={!editable}
        {...(editable ? {} : { disabledReason: t("knowledgeBase.templates.adminsOnly") })}
        onCheckedChange={(value) => void change(value)}
      />
      <SaveStatus
        state={state}
        {...(error ? { error, onRetry: () => void change(!section.required) } : {})}
      />
    </li>
  );
}
