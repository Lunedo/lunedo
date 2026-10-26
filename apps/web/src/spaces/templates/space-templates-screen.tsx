import { Section } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { isKnowledgeBase } from "../../knowledge-bases/queries.js";
import { ArticleTemplateSections } from "../../knowledge-bases/settings/article-template-sections.js";
import { contentKeys } from "../content-queries.js";
import { SpaceSettingsPage } from "../settings/space-settings-page.js";
import { useSpace } from "../space-context.js";
import { templateLevelApi } from "./template-transfer-api.js";
import { type TemplateInput, TemplatesManager } from "./templates-manager.js";

export function SpaceTemplatesScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: contentKeys.spaceTemplates(space.id),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/templates", { params: { path: { spaceId: space.id } } }),
      ),
  });
  const transfer = useMemo(() => templateLevelApi(`/api/v1/spaces/${space.id}`), [space.id]);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: contentKeys.spaceTemplates(space.id) });
    await queryClient.invalidateQueries({ queryKey: contentKeys.gallery(space.id) });
  };
  const path = { spaceId: space.id };
  return (
    <SpaceSettingsPage title={t("templates.title")} description={t("templates.spaceDescription")}>
      {isKnowledgeBase(space) ? <ArticleTemplateSections /> : null}
      <OwnTemplates titled={isKnowledgeBase(space)}>
        <TemplatesManager
          templates={templates.data}
          loading={templates.isPending}
          error={templates.error}
          onRetry={() => void templates.refetch()}
          canManage={space.role === "admin"}
          articleTypes={isKnowledgeBase(space)}
          transfer={transfer}
          onImported={refresh}
          onCreate={async (input: TemplateInput) => {
            await request(() =>
              api.POST("/api/v1/spaces/{spaceId}/templates", { params: { path }, body: input as never }),
            );
            await refresh();
          }}
          onUpdate={async (templateId, input) => {
            await request(() =>
              api.PUT("/api/v1/spaces/{spaceId}/templates/{templateId}", {
                params: { path: { ...path, templateId } },
                body: input as never,
              }),
            );
            await refresh();
          }}
          onDelete={async (templateId) => {
            await request(() =>
              api.DELETE("/api/v1/spaces/{spaceId}/templates/{templateId}", {
                params: { path: { ...path, templateId } },
              }),
            );
            await refresh();
          }}
        />
      </OwnTemplates>
    </SpaceSettingsPage>
  );
}

function OwnTemplates({ titled, children }: { titled: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  if (!titled) return children;
  return (
    <Section title={t("templates.ownTemplates")}>
      <div className="py-4">{children}</div>
    </Section>
  );
}
