import { Button, ConfirmDialog, DangerAction, DangerZone, useToast } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";
import { spaceKeys } from "../space-queries.js";

export function SpaceDangerZone() {
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
