import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { organizationQuery, organizationSettingsQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { SettingsPage } from "../../screens/settings/settings-page.js";
import { useOrganizationSettingMutation } from "../../settings/setting-mutations.js";
import { PAGE_MODE_KEYS, TRASH_KEYS } from "../../settings/settings-index.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { contentKeys } from "../content-queries.js";
import { DeletedContent } from "../trash/deleted-content.js";
import { Panel } from "./panel.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/content");

export function OrganizationContentScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const queryClient = useQueryClient();
  const organization = useQuery(organizationQuery(organizationId));
  const settings = useQuery(organizationSettingsQuery(organizationId));
  const mutation = useOrganizationSettingMutation(organizationId);
  const canManageTrash = state.can("organization.trash.manage");
  const trash = useQuery({
    queryKey: contentKeys.organizationTrash(organizationId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/trash", { params: { path: { organizationId } } }),
      ),
    enabled: canManageTrash,
  });
  const refreshTrash = async () => {
    await queryClient.invalidateQueries({ queryKey: contentKeys.organizationTrash(organizationId) });
    await queryClient.invalidateQueries({ queryKey: ["spaces"] });
  };
  const name = organization.data?.name;
  const change = (key: string, value: Parameters<typeof mutation.mutateAsync>[0]["change"]) =>
    mutation.mutateAsync({ key, change: value }).then(() => undefined);
  return (
    <SettingsPage
      title={t("content.title")}
      description={t("content.organizationDescription")}
      icon={Trash2}
      organizationId={organizationId}
      width="wide"
    >
      <Panel title={t("content.pagesSection")}>
        <SettingsList
          settings={settings.data}
          keys={PAGE_MODE_KEYS}
          level="organization"
          {...(name ? { organizationName: name } : {})}
          canManage={() => state.can("organization.settings.manage")}
          onChange={change}
        />
      </Panel>
      <Panel title={t("content.trashSection")}>
        <SettingsList
          settings={settings.data}
          keys={TRASH_KEYS}
          level="organization"
          {...(name ? { organizationName: name } : {})}
          canManage={() => state.can("organization.settings.manage")}
          onChange={change}
        />
      </Panel>
      {canManageTrash ? (
        <Panel title={t("trash.deletedContent")} description={t("trash.deletedContentDescription")}>
          <DeletedContent
            entries={trash.data}
            loading={trash.isPending}
            error={trash.error}
            onRetry={() => void trash.refetch()}
            onRestore={async (entry) => {
              await request(() =>
                api.POST("/api/v1/organizations/{organizationId}/trash/{entryId}/restore", {
                  params: { path: { organizationId, entryId: entry.id } },
                }),
              );
              await refreshTrash();
            }}
            onDelete={async (entry, reason) => {
              await request(() =>
                api.POST("/api/v1/organizations/{organizationId}/trash/{entryId}/delete", {
                  params: { path: { organizationId, entryId: entry.id } },
                  body: { reason },
                }),
              );
              await refreshTrash();
            }}
          />
        </Panel>
      ) : null}
    </SettingsPage>
  );
}
