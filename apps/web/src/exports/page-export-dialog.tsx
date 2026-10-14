import { Button, Dialog, Notice, RadioGroup, useToast } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFailureToast } from "../errors/failure.js";
import { downloadPageExport, exportKeys, type PageExportFormat, startPagesExport } from "./export-queries.js";

type Choice = PageExportFormat | "subpages";

const CHOICES: readonly Choice[] = ["markdown", "html", "zip", "subpages"];

export function PageExportDialog({
  page,
  space,
  open,
  onOpenChange,
}: {
  page: { id: string; title: string; publishable: boolean };
  space: { key: string; exportEnabled: boolean; admin: boolean };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("exports.page.title")} size="sm">
      {open ? <PageExportForm page={page} space={space} onDone={() => onOpenChange(false)} /> : null}
    </Dialog>
  );
}

export function ExportDisabledNotice({
  spaceKey,
  admin,
  inSettings = false,
}: {
  spaceKey: string;
  admin: boolean;
  inSettings?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Notice variant="info" title={t("exports.disabled.title")}>
      {admin && inSettings ? (
        t("exports.disabled.adminHere")
      ) : admin ? (
        <>
          {t("exports.disabled.admin")}{" "}
          <Link
            to="/spaces/$spaceKey/settings/export"
            params={{ spaceKey }}
            className="font-medium text-accent underline focus-visible:focus-ring"
          >
            {t("exports.disabled.openSettings")}
          </Link>
        </>
      ) : (
        t("exports.disabled.reader")
      )}
    </Notice>
  );
}

function PageExportForm({
  page,
  space,
  onDone,
}: {
  page: { id: string; title: string; publishable: boolean };
  space: { key: string; exportEnabled: boolean; admin: boolean };
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice>("markdown");
  const [busy, setBusy] = useState(false);

  if (!space.exportEnabled || !page.publishable) {
    return (
      <div className="flex flex-col gap-4">
        {space.exportEnabled ? (
          <Notice variant="info" title={t("exports.page.unpublishedTitle")}>
            {t("exports.page.unpublished")}
          </Notice>
        ) : (
          <ExportDisabledNotice spaceKey={space.key} admin={space.admin} />
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onDone}>
            {t("exports.close")}
          </Button>
        </div>
      </div>
    );
  }

  const run = async () => {
    setBusy(true);
    try {
      if (choice === "subpages") {
        await startPagesExport(page.id);
        await queryClient.invalidateQueries({ queryKey: exportKeys.all });
        toast({
          title: t("exports.started.title"),
          description: t("exports.started.description"),
          variant: "success",
          action: {
            label: t("exports.started.open"),
            onSelect: () => void navigate({ to: "/settings/exports" }),
          },
        });
      } else {
        await downloadPageExport(page.id, choice);
      }
      onDone();
    } catch (failure) {
      showFailure(
        choice === "subpages" ? t("exports.started.failed") : t("exports.page.failed", { title: page.title }),
        failure,
        () => void run(),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run();
      }}
    >
      <RadioGroup
        label={t("exports.page.format")}
        variant="card"
        value={choice}
        onValueChange={(value) => setChoice(value as Choice)}
        options={CHOICES.map((value) => ({
          value,
          label: t(`exports.page.formats.${value}.label`),
          description: t(`exports.page.formats.${value}.description`),
        }))}
      />
      <p className="text-sm text-text-muted">{t("exports.page.scope")}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {choice === "subpages" ? t("exports.page.start") : t("exports.page.download")}
        </Button>
      </div>
    </form>
  );
}
