import { Button, Dialog, Notice, RadioGroup, SegmentedControl, Switch, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFailureToast } from "../errors/failure.js";
import {
  defaultExportOptions,
  downloadPageExport,
  type ExportOptions,
  type ExportTarget,
  exportCountsQuery,
  exportKeys,
  startExport,
} from "./export-queries.js";
import { printSearch } from "./print-search.js";

type Choice = "pdf" | "docx" | "html" | "markdown";
type Scope = "page" | "pages" | "space";

const CHOICES: readonly Choice[] = ["pdf", "docx", "html", "markdown"];

export interface ExportSpace {
  id: string;
  key: string;
  name: string;
  exportEnabled: boolean;
  admin: boolean;
  mayExportPages: boolean;
}

export interface ExportPage {
  id: string;
  title: string;
  publishable: boolean;
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

export function ExportDialog({
  page,
  space,
  open,
  onOpenChange,
}: {
  page?: ExportPage;
  space: ExportSpace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("exports.dialog.title", { name: page?.title ?? space.name })}
      size="md"
    >
      {open ? (
        <ExportForm
          page={page}
          space={space}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function targetOf(scope: Scope, page: ExportPage | undefined, space: ExportSpace): ExportTarget {
  return scope === "space" || !page ? { spaceId: space.id } : { pageId: page.id };
}

export function ExportForm({
  page,
  space,
  onDone,
  onCancel,
}: {
  page?: ExportPage | undefined;
  space: ExportSpace;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<Choice>("pdf");
  const [scope, setScope] = useState<Scope>(page ? "page" : "space");
  const [options, setOptions] = useState<ExportOptions>(defaultExportOptions);
  const [serverPdf, setServerPdf] = useState(false);
  const [busy, setBusy] = useState(false);
  const multi = scope !== "page";
  const paged = choice === "pdf" || choice === "docx";
  const target = targetOf(scope, page, space);
  const counts = useQuery({ ...exportCountsQuery(target), enabled: multi && space.mayExportPages });
  const total = counts.data ? counts.data.pages + counts.data.blogPosts : null;
  const tooMany =
    choice === "pdf" &&
    multi &&
    total !== null &&
    counts.data !== undefined &&
    total > counts.data.printLimit;
  const name = page?.title ?? space.name;

  if (!space.exportEnabled || (page && !page.publishable && scope === "page")) {
    return (
      <div className="flex flex-col gap-4">
        {space.exportEnabled ? (
          <Notice variant="info" title={t("exports.page.unpublishedTitle")}>
            {t("exports.page.unpublished")}
          </Notice>
        ) : (
          <ExportDisabledNotice spaceKey={space.key} admin={space.admin} />
        )}
        {onCancel ? (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onCancel}>
              {t("exports.close")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  const set = (change: Partial<ExportOptions>) => setOptions((current) => ({ ...current, ...change }));
  const chooseFormat = (next: Choice) => {
    setChoice(next);
    setServerPdf(false);
  };

  const started = () => {
    toast({
      title: t("exports.started.title"),
      description: t("exports.started.description"),
      variant: "success",
      action: {
        label: t("exports.started.open"),
        onSelect: () => void navigate({ to: "/settings/exports" }),
      },
    });
  };

  const run = async () => {
    setBusy(true);
    try {
      if (choice === "pdf" && !multi && page) {
        onDone();
        await navigate({ to: "/print", search: printSearch({ page: page.id }, options) });
        return;
      }
      if (choice === "pdf" && multi && !serverPdf) {
        const created = await startExport(target, "print", options);
        await queryClient.invalidateQueries({ queryKey: exportKeys.all });
        onDone();
        await navigate({ to: "/print", search: printSearch({ export: created.id }, options) });
        return;
      }
      if (multi) {
        await startExport(target, choice, options);
        await queryClient.invalidateQueries({ queryKey: exportKeys.all });
        started();
        onDone();
        return;
      }
      if (page) {
        const format =
          choice === "docx" ? "docx" : options.attachments ? "zip" : choice === "html" ? "html" : "markdown";
        await downloadPageExport(page.id, format, options);
      }
      onDone();
    } catch (failure) {
      showFailure(t("exports.dialog.failed", { name }), failure, () => void run());
    } finally {
      setBusy(false);
    }
  };

  const adminsOnly = t("exports.dialog.scopes.adminsOnly", { name: space.name });
  const pagesDescription =
    multi && scope === "pages" && counts.data
      ? t("exports.dialog.scopes.pages.counted", { count: counts.data.pages })
      : t("exports.dialog.scopes.pages.description", { title: page?.title ?? "" });
  const spaceDescription =
    scope === "space" && counts.data
      ? t("exports.dialog.scopes.space.counted", { pages: counts.data.pages, posts: counts.data.blogPosts })
      : t("exports.dialog.scopes.space.description");
  const label =
    choice === "pdf" && !serverPdf
      ? multi
        ? t("exports.dialog.preparePrint")
        : t("exports.dialog.openPrint")
      : multi
        ? t("exports.dialog.start")
        : t("exports.dialog.download");

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void run();
      }}
    >
      <RadioGroup
        label={t("exports.dialog.format")}
        variant="card"
        value={choice}
        onValueChange={(value) => chooseFormat(value as Choice)}
        options={CHOICES.map((value) => ({
          value,
          label: t(`exports.dialog.formats.${value}.label`),
          description: t(`exports.dialog.formats.${value}.description`),
        }))}
      />
      {choice === "pdf" && !serverPdf ? (
        <Notice variant="info" title={t("exports.dialog.printHintTitle")}>
          {t("exports.dialog.printHint")} {multi ? t("exports.dialog.printPrepared") : null}
        </Notice>
      ) : null}
      {page ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-medium">{t("exports.dialog.scope")}</legend>
          <RadioGroup
            label={t("exports.dialog.scope")}
            value={scope}
            onValueChange={(value) => {
              setScope(value as Scope);
              setServerPdf(false);
            }}
            options={[
              {
                value: "page",
                label: t("exports.dialog.scopes.page.label"),
                description: t("exports.dialog.scopes.page.description", { title: page.title }),
              },
              {
                value: "pages",
                label: t("exports.dialog.scopes.pages.label"),
                description: space.mayExportPages ? pagesDescription : adminsOnly,
                disabled: !space.mayExportPages,
              },
              {
                value: "space",
                label: t("exports.dialog.scopes.space.label", { name: space.name }),
                description: space.mayExportPages ? spaceDescription : adminsOnly,
                disabled: !space.mayExportPages,
              },
            ]}
          />
        </fieldset>
      ) : (
        <p className="text-sm text-text-muted">{spaceDescription}</p>
      )}
      {counts.isError ? <p className="text-sm text-text-muted">{t("exports.dialog.countsFailed")}</p> : null}
      {tooMany && counts.data && !serverPdf ? (
        <Notice variant="warning" title={t("exports.dialog.tooManyTitle")}>
          <span>
            {counts.data.serverPdf
              ? t("exports.dialog.tooManyServer", { count: total ?? 0, limit: counts.data.printLimit })
              : t("exports.dialog.tooMany", { count: total ?? 0, limit: counts.data.printLimit })}
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            {counts.data.serverPdf ? (
              <Button size="sm" variant="secondary" onClick={() => setServerPdf(true)}>
                {t("exports.dialog.useServer")}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => chooseFormat("docx")}>
              {t("exports.dialog.useWord")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => chooseFormat("html")}>
              {t("exports.dialog.useHtml")}
            </Button>
          </span>
        </Notice>
      ) : null}
      {serverPdf ? <p className="text-sm">{t("exports.dialog.serverChosen")}</p> : null}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">{t("exports.dialog.content")}</legend>
        <OptionSwitch
          label={t("exports.dialog.attachments")}
          description={paged ? t("exports.dialog.attachmentsPaged") : t("exports.dialog.attachmentsFiles")}
          checked={options.attachments}
          onCheckedChange={(attachments) => set({ attachments })}
        />
        {paged ? (
          <>
            <OptionSwitch
              label={t("exports.dialog.comments")}
              description={t("exports.dialog.commentsDescription")}
              checked={options.comments}
              onCheckedChange={(comments) => set({ comments })}
            />
            <OptionSwitch
              label={t("exports.dialog.contents")}
              description={t("exports.dialog.contentsDescription")}
              checked={options.contents}
              onCheckedChange={(contents) => set({ contents })}
            />
          </>
        ) : null}
      </fieldset>
      {paged ? (
        <div className="flex flex-wrap gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium">{t("exports.dialog.paper")}</span>
            <SegmentedControl
              label={t("exports.dialog.paper")}
              value={options.paper}
              onValueChange={(paper) => set({ paper: paper as ExportOptions["paper"] })}
              options={(["a4", "letter"] as const).map((value) => ({
                value,
                label: t(`exports.dialog.papers.${value}`),
              }))}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium">{t("exports.dialog.orientation")}</span>
            <SegmentedControl
              label={t("exports.dialog.orientation")}
              value={options.orientation}
              onValueChange={(orientation) =>
                set({ orientation: orientation as ExportOptions["orientation"] })
              }
              options={(["portrait", "landscape"] as const).map((value) => ({
                value,
                label: t(`exports.dialog.orientations.${value}`),
              }))}
            />
          </div>
        </div>
      ) : null}
      {multi && (choice !== "pdf" || serverPdf) ? (
        <p className="text-sm text-text-muted">{t("exports.dialog.background")}</p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          {...(choice === "pdf" && !serverPdf ? { icon: Printer } : {})}
        >
          {label}
        </Button>
      </div>
    </form>
  );
}

function OptionSwitch({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col">
        <span className="font-medium" aria-hidden="true">
          {label}
        </span>
        <span className="text-sm text-text-muted">{description}</span>
      </div>
      <Switch label={label} labelHidden checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
