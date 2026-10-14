import { Button, ConfirmDialog, DangerAction, DangerZone, useToast } from "@pagehall/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import type { SettingEntry } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { problemMessage } from "../../errors/problem-message.js";
import { StorageUsage } from "../../files/storage-usage.js";
import type { SettingChange } from "../../settings/setting-mutations.js";
import {
  COLLABORATION_KEYS,
  PAGE_MODE_KEYS,
  SEARCH_KEYS,
  SPACE_FILE_KEYS,
  TRASH_KEYS,
} from "../../settings/settings-index.js";
import { contentKeys } from "../content-queries.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";
import { spaceKeys } from "../space-queries.js";
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
    <SpaceSettingsPage
      tab="content"
      title={t("content.title")}
      description={t("content.spaceDescription")}
      icon={Trash2}
    >
      <div className="flex flex-col gap-8">
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
        {space.role === "admin" ? <SpaceDangerZone /> : null}
      </div>
    </SpaceSettingsPage>
  );
}

function SpaceDangerZone() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const name = spaceDisplayName(t, space);
  const typed = space.personal && !space.name ? space.key : space.name;

  const setArchived = async (archived: boolean) => {
    try {
      await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/archived", {
          params: { path: { spaceId: space.id } },
          body: { archived },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
      toast({
        title: archived ? t("archive.spaceArchived", { name }) : t("archive.spaceUnarchived", { name }),
        variant: "success",
      });
    } catch (error) {
      toast({ title: t("archive.spaceFailed"), description: problemMessage(t, error), variant: "error" });
    }
  };

  return (
    <>
      <DangerZone title={t("content.dangerZone")}>
        <DangerAction
          title={space.archived ? t("archive.unarchiveSpace") : t("archive.archiveSpace")}
          description={
            space.archived ? t("archive.unarchiveSpaceDescription") : t("archive.archiveSpaceDescription")
          }
          action={
            space.archived ? (
              <Button variant="secondary" icon={ArchiveRestore} onClick={() => void setArchived(false)}>
                {t("archive.unarchiveSpace")}
              </Button>
            ) : (
              <Button variant="danger" icon={Archive} onClick={() => setConfirm("archive")}>
                {t("archive.archiveSpace")}
              </Button>
            )
          }
        />
        <DangerAction
          title={t("content.deleteSpace")}
          description={t("content.deleteSpaceDescription")}
          action={
            <Button variant="danger" icon={Trash2} onClick={() => setConfirm("delete")}>
              {t("content.deleteSpace")}
            </Button>
          }
        />
      </DangerZone>
      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("archive.archiveSpaceTitle", { name })}
        description={t("archive.archiveSpaceConfirm")}
        confirmLabel={t("archive.archiveSpace")}
        cancelLabel={t("archive.keepSpaceActive")}
        onConfirm={() => setArchived(true)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("content.deleteSpaceTitle", { name })}
        description={
          space.personal ? t("content.deletePersonalSpaceConsequences") : t("content.deleteSpaceConsequences")
        }
        confirmLabel={t("content.deleteSpace")}
        cancelLabel={t("content.keepSpace")}
        destructive
        typedConfirmation={{
          value: typed,
          label: t("content.typeName", { name: typed }),
          mismatch: t("content.nameMismatch"),
        }}
        onConfirm={async () => {
          try {
            await request(() =>
              api.POST("/api/v1/spaces/{spaceId}/delete", {
                params: { path: { spaceId: space.id } },
                body: { confirmation: typed },
              }),
            );
            await queryClient.invalidateQueries({ queryKey: spaceKeys.all });
            toast({ title: t("content.spaceDeleted", { name }), variant: "success" });
            await navigate({ to: "/spaces" });
          } catch (error) {
            toast({
              title: t("content.deleteFailed"),
              description: problemMessage(t, error),
              variant: "error",
            });
          }
        }}
      />
    </>
  );
}
