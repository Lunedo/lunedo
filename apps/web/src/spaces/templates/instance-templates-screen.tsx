import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { SettingsPage } from "../../screens/settings/settings-page.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { contentKeys } from "../content-queries.js";
import { type TemplateInput, TemplatesManager } from "./templates-manager.js";

export function InstanceTemplatesScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: contentKeys.instanceTemplates,
    queryFn: () => request(() => api.GET("/api/v1/instance/templates")),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: contentKeys.instanceTemplates });
    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
  };
  return (
    <SettingsPage
      title={t("templates.title")}
      description={t("templates.instanceDescription")}
      icon={LayoutTemplate}
      width="wide"
    >
      <TemplatesManager
        templates={templates.data}
        loading={templates.isPending}
        error={templates.error}
        onRetry={() => void templates.refetch()}
        canManage={state.can("instance.templates.manage")}
        onCreate={async (input: TemplateInput) => {
          await request(() => api.POST("/api/v1/instance/templates", { body: input as never }));
          await refresh();
        }}
        onUpdate={async (templateId, input) => {
          await request(() =>
            api.PUT("/api/v1/instance/templates/{templateId}", {
              params: { path: { templateId } },
              body: input as never,
            }),
          );
          await refresh();
        }}
        onDelete={async (templateId) => {
          await request(() =>
            api.DELETE("/api/v1/instance/templates/{templateId}", { params: { path: { templateId } } }),
          );
          await refresh();
        }}
      />
    </SettingsPage>
  );
}
