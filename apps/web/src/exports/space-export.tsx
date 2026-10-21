import { useTranslation } from "react-i18next";
import { ExportDialog, ExportDisabledNotice, ExportForm, type ExportSpace } from "./export-dialog.js";
import { ExportsList } from "./exports-list.js";

export type ExportableSpace = Omit<ExportSpace, "mayExportPages">;

export function SpaceExport({ space }: { space: ExportableSpace }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        {space.knowledgeBase ? t("exports.space.descriptionArticles") : t("exports.space.description")}
      </p>
      {space.exportEnabled ? (
        <ExportForm space={{ ...space, mayExportPages: true }} onDone={() => {}} />
      ) : (
        <ExportDisabledNotice spaceKey={space.key} admin={space.admin} inSettings />
      )}
      <ExportsList spaceId={space.id} emptyText={t("exports.space.empty")} />
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
  return <ExportDialog space={{ ...space, mayExportPages: true }} open={open} onOpenChange={onOpenChange} />;
}
