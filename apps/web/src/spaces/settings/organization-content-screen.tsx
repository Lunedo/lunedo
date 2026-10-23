import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { organizationQuery, organizationSettingsQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { OrganizationHomePage } from "../../collaboration/organization-home-page.js";
import { SettingsList } from "../../components/settings-list.js";
import { embedServicesQuery } from "../../editor/embedded-blocks.js";
import { OrganizationEmbedAllowlist } from "../../embeds/embed-allowlist.js";
import { LoadError } from "../../errors/failure.js";
import { StorageUsage } from "../../files/storage-usage.js";
import { SettingsPage } from "../../screens/settings/settings-page.js";
import { useOrganizationSettingMutation } from "../../settings/setting-mutations.js";
import {
  COLLABORATION_KEYS,
  FILE_KEYS,
  PAGE_MODE_KEYS,
  SHARING_KEYS,
  TRASH_KEYS,
} from "../../settings/settings-index.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { contentKeys } from "../content-queries.js";
import { UnownedItems } from "../ownership/unowned-items.js";
import { DeletedContent } from "../trash/deleted-content.js";
import { withParentsQuery } from "../trash/restore-with-parents.js";
import { DeletedConfidentialNotice } from "./confidential-spaces.js";
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
      <Panel title={t("content.collaborationSection")}>
        <SettingsList
          settings={settings.data}
          keys={COLLABORATION_KEYS}
          level="organization"
          {...(name ? { organizationName: name } : {})}
          canManage={() => state.can("organization.settings.manage")}
          onChange={change}
        />
      </Panel>
      <Panel title={t("content.sharingSection")}>
        <SettingsList
          settings={settings.data}
          keys={SHARING_KEYS}
          level="organization"
          {...(name ? { organizationName: name } : {})}
          canManage={() => state.can("organization.settings.manage")}
          onChange={change}
        />
      </Panel>
      <Panel title={t("content.filesSection")}>
        <StorageUsage scope={{ organizationId }} />
        <SettingsList
          settings={settings.data}
          keys={FILE_KEYS}
          level="organization"
          {...(name ? { organizationName: name } : {})}
          canManage={() => state.can("organization.settings.manage")}
          onChange={change}
        />
      </Panel>
      <Panel title={t("embeds.allowlist.title")} description={t("embeds.allowlist.organizationDescription")}>
        <OrganizationEmbeds
          organizationId={organizationId}
          canManage={state.can("organization.settings.manage")}
        />
      </Panel>
      <Panel title={t("home.organizationPage")} description={t("home.organizationPageDescription")}>
        <OrganizationHomePage
          organizationId={organizationId}
          canManage={state.can("organization.settings.manage")}
        />
      </Panel>
      {state.can("organization.spaces.view") ? (
        <Panel
          title={t("ownership.unownedTitle")}
          description={t("ownership.organizationUnownedDescription")}
        >
          <UnownedItems scope={{ organizationId }} showSpace />
        </Panel>
      ) : null}
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
          <DeletedConfidentialNotice organizationId={organizationId} />
          <DeletedContent
            entries={trash.data}
            loading={trash.isPending}
            error={trash.error}
            onRetry={() => void trash.refetch()}
            onRestore={async (entry, withParents) => {
              const result = await request(() =>
                api.POST("/api/v1/organizations/{organizationId}/trash/{entryId}/restore", {
                  params: {
                    path: { organizationId, entryId: entry.id },
                    query: withParentsQuery(withParents),
                  },
                }),
              );
              await refreshTrash();
              return result;
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

function OrganizationEmbeds({ organizationId, canManage }: { organizationId: string; canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutation = useOrganizationSettingMutation(organizationId);
  const query = embedServicesQuery(organizationId);
  const embeds = useQuery({ ...query, throwOnError: false });
  if (embeds.isPending) return null;
  if (embeds.isError) {
    return (
      <LoadError
        what={t("embeds.allowlist.loadFailed")}
        error={embeds.error}
        onRetry={() => void embeds.refetch()}
      />
    );
  }
  const { available, services, narrowed } = embeds.data;
  return (
    <OrganizationEmbedAllowlist
      available={available}
      allowed={narrowed ? services.map((service) => service.id) : null}
      canManage={canManage}
      onSave={async (allowed) => {
        await mutation.mutateAsync({
          key: "embeds.allowedServices",
          change: allowed === null ? { clear: true } : { value: allowed },
        });
        await queryClient.invalidateQueries({ queryKey: query.queryKey });
      }}
    />
  );
}
