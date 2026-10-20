import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileArchive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import type { SettingEntry } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { SpaceExport } from "../../exports/space-export.js";
import { StaticSiteExport } from "../../exports/static-site-export.js";
import { isKnowledgeBase } from "../../knowledge-bases/queries.js";
import type { SettingChange } from "../../settings/setting-mutations.js";
import { EXPORT_KEYS } from "../../settings/settings-index.js";
import { contentKeys } from "../content-queries.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";
import { spaceKeys } from "../space-queries.js";
import { Panel } from "./panel.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

export function SpaceExportScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const admin = space.role === "admin";
  const settings = useQuery({
    queryKey: contentKeys.spaceSettings(space.id),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/settings", { params: { path: { spaceId: space.id } } }),
      ),
    enabled: admin,
  });
  const mutation = useMutation({
    mutationFn: ({ key, change }: { key: string; change: SettingChange }) =>
      request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/settings/{key}", {
          params: { path: { spaceId: space.id, key } },
          body: change as never,
        }),
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: contentKeys.spaceSettings(space.id) });
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
    },
  });
  return (
    <SpaceSettingsPage
      tab="export"
      title={t("exports.settings.title")}
      description={t("exports.settings.description")}
      icon={FileArchive}
    >
      <div className="flex flex-col gap-8">
        {admin ? (
          <Panel title={t("exports.settings.settingTitle")} description={t("exports.settings.copyNote")}>
            <SettingsList
              settings={settings.data as unknown as SettingEntry[] | undefined}
              keys={EXPORT_KEYS}
              level="space"
              organizationName={space.organizationName ?? undefined}
              canManage={() => admin}
              onChange={async (key, change) => {
                await mutation.mutateAsync({ key, change });
              }}
            />
          </Panel>
        ) : null}
        {space.mayExport && isKnowledgeBase(space) ? (
          <Panel title={t("exports.site.title")}>
            <StaticSiteExport
              space={{
                id: space.id,
                key: space.key,
                audience: space.audience ?? null,
                exportEnabled: space.exportEnabled,
              }}
            />
          </Panel>
        ) : null}
        {space.mayExport ? (
          <Panel title={t("exports.space.panelTitle")}>
            <SpaceExport
              space={{
                id: space.id,
                key: space.key,
                name: spaceDisplayName(t, space),
                exportEnabled: space.exportEnabled,
                admin,
              }}
            />
          </Panel>
        ) : null}
      </div>
    </SpaceSettingsPage>
  );
}
