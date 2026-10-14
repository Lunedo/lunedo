import { Button, Dialog, useToast } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileArchive } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFailureToast } from "../errors/failure.js";
import { exportKeys, startSpaceExport } from "./export-queries.js";
import { ExportsList } from "./exports-list.js";
import { ExportDisabledNotice } from "./page-export-dialog.js";

export interface ExportableSpace {
  id: string;
  key: string;
  name: string;
  exportEnabled: boolean;
  admin: boolean;
}

export function SpaceExport({ space, inDialog = false }: { space: ExportableSpace; inDialog?: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      await startSpaceExport(space.id);
      toast({
        title: t("exports.started.title"),
        description: t("exports.started.description"),
        variant: "success",
      });
    } catch (failure) {
      showFailure(t("exports.started.failed"), failure, () => void start());
    } finally {
      await queryClient.invalidateQueries({ queryKey: exportKeys.all });
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">{t("exports.space.description")}</p>
      {space.exportEnabled ? (
        <div>
          <Button variant="primary" icon={FileArchive} loading={busy} onClick={() => void start()}>
            {t("exports.space.start")}
          </Button>
        </div>
      ) : (
        <ExportDisabledNotice spaceKey={space.key} admin={space.admin} inSettings={!inDialog} />
      )}
      {inDialog ? (
        <p className="text-sm">
          <Link to="/settings/exports" className="font-medium text-accent underline focus-visible:focus-ring">
            {t("exports.space.yourExports")}
          </Link>
        </p>
      ) : (
        <ExportsList spaceId={space.id} emptyText={t("exports.space.empty")} />
      )}
    </div>
  );
}

export function SpaceExportDialog({
  space,
  open,
  onOpenChange,
}: {
  space: ExportableSpace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("exports.space.title", { name: space.name })}>
      {open ? <SpaceExport space={space} inDialog /> : null}
    </Dialog>
  );
}
