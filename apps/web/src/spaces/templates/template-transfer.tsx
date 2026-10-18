import { renderHtml } from "@pagehall/editor-schema";
import {
  Badge,
  Button,
  Checkbox,
  classNames,
  Dialog,
  ErrorState,
  Field,
  focusFirstInvalidSoon,
  Icon,
  Input,
  Notice,
  RadioGroup,
  Section,
  Select,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Download, FileUp, Upload } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isApiError } from "../../api/request.js";
import { readViewContext } from "../../editor/read-view.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import {
  type ImportDecision,
  type ImportedTemplate,
  type ImportPreview,
  type RemovedReferences,
  removedEntries,
  type TemplateLevelApi,
} from "./template-transfer-api.js";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const NAME_MAX_LENGTH = 100;

export function useRemovedText() {
  const { t } = useTranslation();
  return (removed: RemovedReferences) =>
    removedEntries(removed)
      .map(([kind, count]) => t(`templates.removed.${kind}` as "templates.removed.pageLink", { count }))
      .join(", ");
}

export function ExportDialog({
  api,
  templateIds,
  open,
  onOpenChange,
}: {
  api: TemplateLevelApi;
  templateIds: string[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const removedText = useRemovedText();
  const [downloading, setDownloading] = useState(false);
  const summary = useQuery({
    queryKey: ["templates", "export-summary", templateIds],
    queryFn: () => api.exportSummary(templateIds),
    enabled: open,
    gcTime: 0,
  });
  const download = async () => {
    setDownloading(true);
    try {
      await api.exportFile(templateIds);
      toast({ variant: "success", title: t("templates.exported") });
      onOpenChange(false);
    } catch (failure) {
      toast({
        variant: "error",
        title: t("templates.exportFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("templates.exportTitle")}
      description={t("templates.exportDescription")}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            icon={Download}
            loading={downloading}
            disabled={!summary.data}
            onClick={() => void download()}
          >
            {t("templates.download")}
          </Button>
        </>
      }
    >
      {summary.error ? (
        <ErrorState
          title={t("templates.exportLoadFailed")}
          cause={problemMessage(t, summary.error)}
          onRetry={() => void summary.refetch()}
        />
      ) : !summary.data ? (
        <Skeleton className="h-field w-full" />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t("templates.exportContents")}>
          {summary.data.templates.map((template, index) => {
            const removed = removedText(template.removed);
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: names of templates in an export may repeat
                key={index}
                className="flex min-w-0 flex-col rounded-md border border-border p-3"
              >
                <span className="truncate font-medium" title={template.name}>
                  {template.name}
                </span>
                <span className="text-sm text-text-muted">
                  {removed
                    ? t("templates.exportRemoves", { list: removed })
                    : t("templates.exportNothingRemoved")}
                </span>
                {template.files > 0 ? (
                  <span className="text-sm text-text-muted">
                    {t("templates.exportImages", { count: template.files })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

export function BuiltInExport({ api }: { api: TemplateLevelApi }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [language, setLanguage] = useState<"en" | "de">("en");
  const [busy, setBusy] = useState(false);
  const exportBuiltIn = api.exportBuiltIn;
  if (!exportBuiltIn) return null;
  const run = async () => {
    setBusy(true);
    try {
      await exportBuiltIn(language);
      toast({ variant: "success", title: t("templates.exported") });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("templates.exportFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("templates.builtInTitle")}>
      <p className="text-sm text-text-muted">{t("templates.builtInDescription")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("templates.builtInLanguage")}>
          <Select
            value={language}
            onValueChange={(value) => setLanguage(value as "en" | "de")}
            options={[
              { value: "en", label: t("templates.languages.en") },
              { value: "de", label: t("templates.languages.de") },
            ]}
          />
        </Field>
        <Button variant="secondary" icon={Download} loading={busy} onClick={() => void run()}>
          {t("templates.builtInExport")}
        </Button>
      </div>
    </Section>
  );
}

interface Choice {
  action: "replace" | "create";
  name: string;
}

function TemplatePreviewCard({
  template,
  api,
  importId,
  choice,
  error,
  onChoice,
}: {
  template: ImportedTemplate;
  api: TemplateLevelApi;
  importId: string;
  choice: Choice | undefined;
  error: string | undefined;
  onChoice: (choice: Choice) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const removedText = useRemovedText();
  const html = useMemo(() => {
    if (!template.document) return null;
    try {
      return renderHtml(template.document, {
        ...readViewContext({ people: {}, pages: {} }, t, format, (fileId) =>
          api.previewFileUrl(importId, fileId),
        ),
        showPlaceholders: true,
      });
    } catch {
      return null;
    }
  }, [template.document, api, importId, t, format]);
  const removed = removedText(template.removed);
  const images = template.files.filter((file) => file.mediaType.startsWith("image/"));
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-md border border-border p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium" title={template.name}>
          {template.name}
        </span>
        {template.category ? (
          <Badge variant="neutral">{t(`templates.categories.${template.category}`)}</Badge>
        ) : null}
        <Badge variant={!template.valid ? "danger" : template.conflict ? "warning" : "success"}>
          {!template.valid
            ? t("templates.importInvalid")
            : template.conflict
              ? t("templates.importExists")
              : t("templates.importValid")}
        </Badge>
      </div>
      {template.valid ? (
        <p className="text-sm text-text-muted">
          {t("templates.importFields", { count: template.fields.length })}
          {images.length > 0 ? ` · ${t("templates.exportImages", { count: images.length })}` : ""}
        </p>
      ) : null}
      {template.problems.length > 0 ? (
        <Notice variant="danger" title={t("templates.importProblems")}>
          <ul className="list-disc pl-5">
            {template.problems.map((problem, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: problems have no identity of their own
              <li key={index}>{problem.message}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {removed || template.blockedEmbeds.length > 0 ? (
        <Notice variant="warning" title={t("templates.importWarnings")}>
          <ul className="list-disc pl-5">
            {removed ? <li>{t("templates.importRemoved", { list: removed })}</li> : null}
            {template.blockedEmbeds.length > 0 ? (
              <li className="break-words">
                {t("templates.importBlockedEmbeds", { list: template.blockedEmbeds.join(", ") })}
              </li>
            ) : null}
          </ul>
        </Notice>
      ) : null}
      {template.valid && template.conflict && choice ? (
        <div className="flex flex-col gap-2">
          <RadioGroup
            label={t("templates.importConflict", { name: template.name })}
            value={choice.action}
            onValueChange={(value) => onChoice({ ...choice, action: value as Choice["action"] })}
            options={[
              { value: "create", label: t("templates.importNewName") },
              {
                value: "replace",
                label: t("templates.importReplace"),
                description: t("templates.importReplaceHint"),
              },
            ]}
          />
          {choice.action === "create" ? (
            <Field label={t("templates.importNewNameLabel")} error={error} required>
              <Input
                value={choice.name}
                aria-invalid={error ? true : undefined}
                onChange={(event) => onChoice({ ...choice, name: event.target.value })}
              />
            </Field>
          ) : null}
        </div>
      ) : null}
      {template.valid && html ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">{t("templates.importShowPreview")}</summary>
          <div
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the preview scrolls and must be reachable by keyboard
            tabIndex={0}
            className="ph-content ph-read-view mt-2 max-h-dialog-sm overflow-y-auto rounded-md border border-border bg-surface p-3 text-sm"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the checked template
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </details>
      ) : null}
    </li>
  );
}

function FilePicker({
  file,
  error,
  onFile,
}: {
  file: File | null;
  error: string | null;
  onFile: (file: File) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const inputId = useId();
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files[0];
          if (dropped) onFile(dropped);
        }}
        className={classNames(
          "flex cursor-pointer flex-wrap items-center gap-3 rounded-md border-2 border-dashed bg-surface-sunken p-4 focus-within:focus-ring",
          dragging ? "border-accent bg-accent-soft" : error ? "border-danger" : "border-border",
        )}
      >
        <Icon icon={FileUp} className="text-text-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium" title={file?.name}>
            {file ? file.name : t("templates.importDrop")}
          </span>
          {file ? <span className="text-sm text-text-muted">{format.bytes(file.size)}</span> : null}
          <span id={hintId} className="text-sm text-text-muted">
            {t("templates.importHint", { size: format.bytes(MAX_UPLOAD_BYTES) })}
          </span>
        </span>
        <span className="font-medium text-accent">{t("templates.importChoose")}</span>
        <input
          id={inputId}
          type="file"
          accept=".json,.zip,application/json,application/zip"
          aria-describedby={hintId}
          {...(error ? { "aria-invalid": true } : {})}
          className="sr-only"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) onFile(chosen);
            event.target.value = "";
          }}
        />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

export function ImportDialog({
  api,
  open,
  onOpenChange,
  onImported,
}: {
  api: TemplateLevelApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const discarded = useRef<string | null>(null);

  const reset = () => {
    setFile(null);
    setFileError(null);
    setFailure(null);
    setPreview(null);
    setChoices({});
    setSkipInvalid(false);
    setErrors({});
  };

  const close = () => {
    const id = preview?.id;
    if (id && discarded.current !== id) {
      discarded.current = id;
      void api.discard(id).catch(() => undefined);
    }
    reset();
    onOpenChange(false);
  };

  const check = async () => {
    if (!file) {
      setFileError(t("templates.importFileRequired"));
      focusFirstInvalidSoon();
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileError(t("templates.importTooLarge"));
      focusFirstInvalidSoon();
      return;
    }
    setChecking(true);
    setFailure(null);
    try {
      const result = await api.preview(file);
      setPreview(result);
      setChoices(
        Object.fromEntries(
          result.templates
            .filter((template) => template.valid && template.conflict)
            .map((template) => [
              template.index,
              { action: "create", name: template.conflict?.suggestedName ?? template.name },
            ]),
        ),
      );
    } catch (error) {
      setFailure(error);
    } finally {
      setChecking(false);
    }
  };

  const valid = preview?.templates.filter((template) => template.valid) ?? [];
  const invalid = (preview?.templates.length ?? 0) - valid.length;

  const confirm = async () => {
    if (!preview) return;
    const found: Record<number, string> = {};
    const taken = new Set(
      preview.templates
        .filter((template) => template.conflict)
        .map((template) => template.name.toLowerCase()),
    );
    const chosen = new Set<string>();
    for (const [index, choice] of Object.entries(choices)) {
      if (choice.action !== "create") continue;
      const name = choice.name.trim();
      if (name.length === 0 || name.length > NAME_MAX_LENGTH)
        found[Number(index)] = t("templates.nameInvalid");
      else if (taken.has(name.toLowerCase()) || chosen.has(name.toLowerCase())) {
        found[Number(index)] = t("templates.importNameTaken");
      }
      chosen.add(name.toLowerCase());
    }
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    const decisions: ImportDecision[] = Object.entries(choices).map(([index, choice]) =>
      choice.action === "replace"
        ? { index: Number(index), action: "replace" }
        : { index: Number(index), action: "create", name: choice.name.trim() },
    );
    setImporting(true);
    try {
      const result = await api.confirm(preview.id, decisions, skipInvalid);
      discarded.current = preview.id;
      await onImported();
      toast({
        variant: "success",
        title: t("templates.imported", { created: result.created.length, replaced: result.replaced.length }),
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      const index = isApiError(error, "templateNameTaken") ? error.problem.templateIndex : undefined;
      if (index !== undefined && choices[index]?.action === "create") {
        setErrors({ [index]: t("templates.importNameTaken") });
        focusFirstInvalidSoon();
        return;
      }
      toast({
        variant: "error",
        title: t("templates.importConfirmFailed"),
        description: problemMessage(t, error),
      });
    } finally {
      setImporting(false);
    }
  };

  const canImport = valid.length > 0 && (invalid === 0 || skipInvalid);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("templates.importTitle")}
      description={preview ? t("templates.importPreviewDescription") : t("templates.importDescription")}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          {preview ? (
            <Button
              variant="primary"
              icon={Upload}
              loading={importing}
              disabled={!canImport}
              onClick={() => void confirm()}
            >
              {t("templates.importConfirm", { count: valid.length })}
            </Button>
          ) : (
            <Button variant="primary" loading={checking} onClick={() => void check()}>
              {t("templates.importCheck")}
            </Button>
          )}
        </>
      }
    >
      {preview ? (
        <div className="flex flex-col gap-3">
          {valid.length === 0 ? (
            <Notice variant="danger">{t("templates.importNothing")}</Notice>
          ) : invalid > 0 ? (
            <Checkbox
              checked={skipInvalid}
              onCheckedChange={setSkipInvalid}
              label={t("templates.importSkipInvalid")}
              description={t("templates.importSkipInvalidHint", { count: invalid })}
            />
          ) : null}
          {valid.length > 0 && invalid > 0 && !skipInvalid ? (
            <p className="text-sm text-text-muted">{t("templates.importSkipInvalidRequired")}</p>
          ) : null}
          <ul className="flex flex-col gap-3" aria-label={t("templates.importContents")}>
            {preview.templates.map((template) => (
              <TemplatePreviewCard
                key={template.index}
                template={template}
                api={api}
                importId={preview.id}
                choice={choices[template.index]}
                error={errors[template.index]}
                onChoice={(choice) => setChoices((current) => ({ ...current, [template.index]: choice }))}
              />
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <FilePicker
            file={file}
            error={fileError}
            onFile={(chosen) => {
              setFile(chosen);
              setFileError(null);
              setFailure(null);
            }}
          />
          {failure ? (
            <ErrorState
              title={t("templates.importFailed", { name: file?.name ?? "" })}
              cause={problemMessage(t, failure)}
              onRetry={() => void check()}
            />
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
