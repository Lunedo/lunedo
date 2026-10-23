import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { SettingsPage } from "../../screens/settings/settings-page.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { contentKeys } from "../content-queries.js";
import { templateLevelApi } from "./template-transfer-api.js";
import { type TemplateInput, TemplatesManager } from "./templates-manager.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/templates");

export function OrganizationTemplatesScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: contentKeys.organizationTemplates(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/templates", { params: { path: { organizationId } } }),
      ),
  });
  const transfer = useMemo(
    () => templateLevelApi(`/api/v1/organizations/${organizationId}`),
    [organizationId],
  );
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: contentKeys.organizationTemplates(organizationId) });
    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
  };
  return (
    <SettingsPage
      title={t("templates.title")}
      description={t("templates.organizationDescription")}
      width="wide"
    >
      <TemplatesManager
        templates={templates.data}
        loading={templates.isPending}
        error={templates.error}
        onRetry={() => void templates.refetch()}
        canManage={state.can("organization.templates.manage")}
        transfer={transfer}
        onImported={refresh}
        onCreate={async (input: TemplateInput) => {
          await request(() =>
            api.POST("/api/v1/organizations/{organizationId}/templates", {
              params: { path: { organizationId } },
              body: input as never,
            }),
          );
          await refresh();
        }}
        onUpdate={async (templateId, input) => {
          await request(() =>
            api.PUT("/api/v1/organizations/{organizationId}/templates/{templateId}", {
              params: { path: { organizationId, templateId } },
              body: input as never,
            }),
          );
          await refresh();
        }}
        onDelete={async (templateId) => {
          await request(() =>
            api.DELETE("/api/v1/organizations/{organizationId}/templates/{templateId}", {
              params: { path: { organizationId, templateId } },
            }),
          );
          await refresh();
        }}
      />
    </SettingsPage>
  );
}
