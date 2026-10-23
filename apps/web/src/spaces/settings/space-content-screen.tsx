import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import type { SettingEntry } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { StorageUsage } from "../../files/storage-usage.js";
import { isKnowledgeBase } from "../../knowledge-bases/queries.js";
import type { SettingChange } from "../../settings/setting-mutations.js";
import {
  COLLABORATION_KEYS,
  PAGE_MODE_KEYS,
  SEARCH_KEYS,
  SPACE_FILE_KEYS,
  TRASH_KEYS,
} from "../../settings/settings-index.js";
import { contentKeys } from "../content-queries.js";
import { UnownedItems } from "../ownership/unowned-items.js";
import { useSpace } from "../space-context.js";
import { Panel } from "./panel.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

export function SpaceContentScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: contentKeys.spaceSettings(space.id),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/settings", { params: { path: { spaceId: space.id } } }),
      ),
  });
  const mutation = useMutation({
    mutationFn: ({ key, change }: { key: string; change: SettingChange }) =>
      request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/settings/{key}", {
          params: { path: { spaceId: space.id, key } },
          body: change as never,
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: contentKeys.spaceSettings(space.id) }),
  });
  const entries = settings.data as unknown as SettingEntry[] | undefined;
  const onChange = async (key: string, change: SettingChange) => {
    await mutation.mutateAsync({ key, change });
  };
  return (
    <SpaceSettingsPage title={t("content.title")} description={t("content.spaceDescription")}>
      <div className="flex flex-col gap-8">
        {space.role === "admin" ? (
          <Panel title={t("ownership.unownedTitle")} description={t("ownership.spaceUnownedDescription")}>
            <UnownedItems scope={{ spaceId: space.id }} />
          </Panel>
        ) : null}
        {isKnowledgeBase(space) ? (
          <Panel title={t("content.pagesSection")}>
            <p className="text-sm">{t("knowledgeBase.publishOnly")}</p>
          </Panel>
        ) : (
          <Panel title={t("content.pagesSection")}>
            <SettingsList
              settings={entries}
              keys={PAGE_MODE_KEYS}
              level="space"
              organizationName={space.organizationName ?? undefined}
              canManage={() => space.role === "admin"}
              onChange={onChange}
            />
          </Panel>
        )}
        <Panel title={t("content.searchSection")}>
          <SettingsList
            settings={entries}
            keys={SEARCH_KEYS}
            level="space"
            organizationName={space.organizationName ?? undefined}
            canManage={() => space.role === "admin"}
            onChange={onChange}
          />
        </Panel>
        <Panel title={t("content.collaborationSection")}>
          <SettingsList
            settings={entries}
            keys={COLLABORATION_KEYS}
            level="space"
            organizationName={space.organizationName ?? undefined}
            canManage={() => space.role === "admin"}
            onChange={onChange}
          />
        </Panel>
        <Panel title={t("content.filesSection")}>
          {space.role === "admin" ? <StorageUsage scope={{ spaceId: space.id }} /> : null}
          <SettingsList
            settings={entries}
            keys={SPACE_FILE_KEYS}
            level="space"
            organizationName={space.organizationName ?? undefined}
            canManage={() => space.role === "admin"}
            onChange={onChange}
          />
        </Panel>
        <Panel title={t("content.trashSection")}>
          <SettingsList
            settings={entries}
            keys={TRASH_KEYS}
            level="space"
            organizationName={space.organizationName ?? undefined}
            canManage={() => space.role === "admin"}
            onChange={onChange}
          />
        </Panel>
      </div>
    </SpaceSettingsPage>
  );
}
