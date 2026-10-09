import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceSettingsQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { SettingsPage } from "../../screens/settings/settings-page.js";
import { useInstanceSettingMutation } from "../../settings/setting-mutations.js";
import {
  INSTANCE_FILE_KEYS,
  SHARING_KEYS,
  TRASH_KEYS,
  TRASH_MINIMUM_KEYS,
} from "../../settings/settings-index.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { contentKeys } from "../content-queries.js";
import { DeletedContent } from "../trash/deleted-content.js";
import { Panel } from "./panel.js";

export function InstanceContentScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const queryClient = useQueryClient();
  const settings = useQuery(instanceSettingsQuery);
  const mutation = useInstanceSettingMutation();
  const canManagePersonal = state.can("instance.personalSpaces.manage");
  const trash = useQuery({
    queryKey: contentKeys.personalTrash,
    queryFn: () => request(() => api.GET("/api/v1/instance/personal-spaces/trash")),
    enabled: canManagePersonal,
  });
  const refreshTrash = async () => {
    await queryClient.invalidateQueries({ queryKey: contentKeys.personalTrash });
    await queryClient.invalidateQueries({ queryKey: ["instance", "personalSpaces"] });
  };
  const change = (key: string, value: Parameters<typeof mutation.mutateAsync>[0]["change"]) =>
    mutation.mutateAsync({ key, change: value }).then(() => undefined);
  const canManage = () => state.can("instance.settings.manage");
  return (
    <SettingsPage
      title={t("content.title")}
      description={t("content.instanceDescription")}
      icon={Trash2}
      width="wide"
    >
      <Panel title={t("content.pagesSection")}>
        <SettingsList
          settings={settings.data}
          keys={["pages.liveVersionIdleMinutes"]}
          level="instance"
          canManage={canManage}
          onChange={change}
        />
      </Panel>
      <Panel title={t("content.trashSection")} description={t("content.minimumHint")}>
        <SettingsList
          settings={settings.data}
          keys={[...TRASH_MINIMUM_KEYS, ...TRASH_KEYS]}
          level="instance"
          canManage={canManage}
          onChange={change}
        />
      </Panel>
      <Panel title={t("content.sharingSection")}>
        <SettingsList
          settings={settings.data}
          keys={SHARING_KEYS}
          level="instance"
          canManage={canManage}
          onChange={change}
        />
      </Panel>
      <Panel title={t("content.filesSection")}>
        <SettingsList
          settings={settings.data}
          keys={INSTANCE_FILE_KEYS}
          level="instance"
          canManage={canManage}
          onChange={change}
        />
      </Panel>
      {canManagePersonal ? (
        <Panel title={t("trash.deletedPersonal")} description={t("trash.deletedPersonalDescription")}>
          <DeletedContent
            entries={trash.data}
            loading={trash.isPending}
            error={trash.error}
            onRetry={() => void trash.refetch()}
            onRestore={async (entry) => {
              await request(() =>
                api.POST("/api/v1/instance/personal-spaces/trash/{entryId}/restore", {
                  params: { path: { entryId: entry.id } },
                }),
              );
              await refreshTrash();
            }}
            onDelete={async (entry, reason) => {
              await request(() =>
                api.POST("/api/v1/instance/personal-spaces/trash/{entryId}/delete", {
                  params: { path: { entryId: entry.id } },
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
