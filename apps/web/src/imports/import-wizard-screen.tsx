import {
  Button,
  ConfirmDialog,
  classNames,
  DangerAction,
  DangerZone,
  ErrorState,
  Field,
  FieldError,
  focusFirstInvalidSoon,
  IconButton,
  Input,
  Notice,
  RadioGroup,
  Section,
  Select,
  Skeleton,
  Switch,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, FileInput, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError, useFailureToast } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { SettingsPage } from "../screens/settings/settings-page.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { HolderPicker } from "../spaces/access/holders.js";
import { FolderPath } from "./folder-path.js";
import { errorText, importTitle } from "./import-labels.js";
import {
  folderQuery,
  type ImportUpdate,
  type ImportView,
  importKeys,
  importQuery,
  removeImport,
  selectSpaces,
  setReviewers,
  startImport,
  updateImport,
} from "./imports-api.js";
import { type PeopleChoice, PeopleStep } from "./people-step.js";
import {
  ConnectionStep,
  DocumentsField,
  inputOf,
  MAX_DOCUMENT_BYTES,
  ownSpaceOf,
  type Selection,
  SelectionStep,
  SourceChoice,
  type SourceInput,
  SplitField,
  selectionOf,
  stepsFor,
  ThrottleNotice,
  WaitingNotice,
} from "./source-steps.js";
import { UploadField } from "./upload-field.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/imports/$importId/setup");
const SAVE_DELAY_MS = 600;
const KEY_PATTERN = /^[A-Z0-9]{2,10}$/;

interface Form {
  spaceName: string;
  spaceKey: string;
  archived: boolean;
  history: boolean;
  sourceUrl: string;
}

function formBody(form: Form, input: SourceInput): ImportUpdate {
  const body: ImportUpdate = { archived: form.archived };
  if (input === "export") body.history = form.history;
  if (input === "export" || input === "connection") body.sourceUrl = form.sourceUrl.trim() || null;
  if (form.spaceName.trim()) body.spaceName = form.spaceName.trim();
  if (KEY_PATTERN.test(form.spaceKey)) body.spaceKey = form.spaceKey;
  return body;
}

function isEditable(state: ImportView["state"]): boolean {
  return state === "draft" || state === "analyzing" || state === "ready";
}

function formOf(entry: ImportView): Form {
  return {
    spaceName: entry.spaceName ?? "",
    spaceKey: entry.spaceKey ?? "",
    archived: entry.archived,
    history: entry.history,
    sourceUrl: entry.sourceUrl ?? "",
  };
}

export function ImportWizardScreen() {
  const { t } = useTranslation();
  const { organizationId, importId } = route.useParams();
  const query = useQuery(importQuery(importId));
  if (query.isPending) {
    return (
      <SettingsPage title={t("imports.wizard.title")} icon={FileInput} organizationId={organizationId}>
        <Skeleton className="h-control-field w-full" />
      </SettingsPage>
    );
  }
  if (query.isError) {
    return (
      <SettingsPage title={t("imports.wizard.title")} icon={FileInput} organizationId={organizationId}>
        <LoadError what={t("imports.wizard.loadFailed")} error={query.error} onRetry={query.refetch} />
      </SettingsPage>
    );
  }
  return <Wizard organizationId={organizationId} entry={query.data} />;
}

function Wizard({ organizationId, entry }: { organizationId: string; entry: ImportView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = route.useSearch();
  const state = useOrganizationState();
  const organization = state.organizations.find((candidate) => candidate.id === organizationId) ?? null;
  const reimport = entry.targetSpace;
  const input = inputOf(entry.source);
  const stepNames = stepsFor(entry.source, Boolean(reimport));
  const index = Math.max(0, Math.min(stepNames.length - 1, search.step ?? entry.draftStep));
  const step = stepNames[index] ?? "source";
  const [form, setForm] = useState<Form>(() => formOf(entry));
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<keyof Form | "file" | "people" | "connection" | "selection" | "start", string>>
  >({});
  const [peopleAttempt, setPeopleAttempt] = useState(0);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [selection, setSelection] = useState<Selection>(() => selectionOf(entry));
  const [peopleChoice, setPeopleChoice] = useState<PeopleChoice>(
    (entry.peopleSource?.kind as PeopleChoice | undefined) ?? "token",
  );
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const failed = useFailureToast();
  const saved = useRef(JSON.stringify(formOf(entry)));
  const suggested = useRef({ name: entry.spaceName, key: entry.spaceKey });

  useEffect(() => {
    if (entry.sourceUrl) {
      const url = entry.sourceUrl;
      setForm((current) => (current.sourceUrl ? current : { ...current, sourceUrl: url }));
    }
  }, [entry.sourceUrl]);

  useEffect(() => {
    if (entry.spaceName !== suggested.current.name || entry.spaceKey !== suggested.current.key) {
      suggested.current = { name: entry.spaceName, key: entry.spaceKey };
      setForm((current) => ({
        ...current,
        spaceName: current.spaceName || (entry.spaceName ?? ""),
        spaceKey: current.spaceKey || (entry.spaceKey ?? ""),
      }));
    }
  }, [entry.spaceName, entry.spaceKey]);

  useEffect(() => {
    if (entry.state === "running" || entry.state === "review") {
      void navigate({
        to: "/settings/organizations/$organizationId/imports/$importId",
        params: { organizationId, importId: entry.id },
      });
    }
  }, [entry.state, entry.id, organizationId, navigate]);

  const patch = useCallback(
    async (body: ImportUpdate) => {
      setSaving(true);
      try {
        const updated = await updateImport(entry.id, body);
        queryClient.setQueryData(importKeys.detail(entry.id), updated);
        setSaveError(null);
        return updated;
      } catch (error) {
        setSaveError(error);
        throw error;
      } finally {
        setSaving(false);
      }
    },
    [entry.id, queryClient],
  );

  useEffect(() => {
    const text = JSON.stringify(form);
    if (text === saved.current || reimport) return;
    const timer = setTimeout(() => {
      patch(formBody(form, input))
        .then(() => {
          saved.current = text;
        })
        .catch(() => undefined);
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [form, patch, reimport, input]);

  const goTo = (next: number) => {
    void navigate({ to: ".", search: { step: next } });
    const text = JSON.stringify(form);
    const body: ImportUpdate =
      text === saved.current || !isEditable(entry.state) || reimport
        ? { draftStep: next }
        : { draftStep: next, ...formBody(form, input) };
    patch(body)
      .then(() => {
        saved.current = text;
      })
      .catch(() => undefined);
  };

  const validateSpace = async (): Promise<boolean> => {
    const next: typeof errors = {};
    if (form.spaceName.trim() === "") next.spaceName = t("imports.wizard.space.nameRequired");
    if (!KEY_PATTERN.test(form.spaceKey)) next.spaceKey = t("imports.wizard.space.keyInvalid");
    else {
      const check = await request(() =>
        api.GET("/api/v1/organizations/{organizationId}/space-keys/{key}", {
          params: { path: { organizationId, key: form.spaceKey } },
        }),
      ).catch(() => null);
      if (check && !check.available)
        next.spaceKey = t("imports.wizard.space.keyTaken", { key: form.spaceKey });
    }
    if (form.sourceUrl.trim() && !/^https?:\/\/\S+$/i.test(form.sourceUrl.trim())) {
      next.sourceUrl = t("imports.wizard.space.sourceUrlInvalid");
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const fail = (field: keyof typeof errors, message: string) => {
    setErrors({ [field]: message });
    focusFirstInvalidSoon();
  };

  const filesReady = () =>
    input === "documents"
      ? entry.files.length > 0 && entry.files.every((file) => file.complete)
      : Boolean(entry.file?.complete);

  const saveSelection = async (): Promise<boolean> => {
    const own = ownSpaceOf(entry, selection);
    if (!own) {
      fail("selection", t("imports.selection.spaceRequired"));
      return false;
    }
    if (selection.pageIds !== null && selection.pageIds.length === 0) {
      fail("selection", t("imports.selection.treeRequired"));
      return false;
    }
    const chosen = entry.connection?.selection.map((item) => item.spaceKey) ?? [];
    if (JSON.stringify([...chosen].sort()) !== JSON.stringify([...selection.spaceKeys].sort())) {
      setSaving(true);
      try {
        const updated = await selectSpaces(entry.id, selection.spaceKeys);
        queryClient.setQueryData(importKeys.detail(entry.id), updated);
        setSaveError(null);
      } catch (error) {
        setSaveError(error);
        throw error;
      } finally {
        setSaving(false);
      }
      await queryClient.invalidateQueries({ queryKey: importKeys.all });
    }
    await patch({
      options: {
        spaceKey: own,
        pageIds: selection.pageIds ?? [],
        blogPosts: selection.pageIds === null && selection.blogPosts,
      },
      ...(reimport ? {} : { history: selection.history }),
    });
    return true;
  };

  const next = async () => {
    if (step === "source") {
      if (input === "export" && !entry.file?.complete) {
        fail("file", t("imports.wizard.source.fileRequired"));
        return;
      }
      setErrors({});
      goTo(index + 1);
      return;
    }
    if (step === "people") {
      const problem = peopleProblem();
      if (problem) {
        fail("people", problem);
        setPeopleAttempt((count) => count + 1);
        return;
      }
      setErrors({});
      goTo(index + 1);
      return;
    }
    if (step === "connection") {
      if (!entry.connection) {
        fail("connection", t("imports.connection.required"));
        setConnectionAttempt((count) => count + 1);
        return;
      }
      setErrors({});
      goTo(index + 1);
      return;
    }
    if (step === "selection") {
      try {
        if (!(await saveSelection())) return;
      } catch {
        return;
      }
      setErrors({});
      goTo(index + 1);
      return;
    }
    if (step === "upload") {
      if (!filesReady()) {
        fail(
          "file",
          t(input === "documents" ? "imports.documents.required" : "imports.wizard.source.fileRequired"),
        );
        return;
      }
      setErrors({});
      goTo(index + 1);
      return;
    }
    if (step === "space") {
      if (!(await validateSpace())) {
        focusFirstInvalidSoon();
        return;
      }
      goTo(index + 1);
    }
  };

  function peopleProblem(): string | null {
    if (
      entry.peopleSource?.kind === peopleChoice &&
      (peopleChoice !== "token" || entry.peopleSource.site !== null)
    ) {
      return null;
    }
    return t(`imports.people.${peopleChoice}.missing`);
  }

  const start = async () => {
    setStarting(true);
    setErrors({});
    try {
      if (input === "export" && peopleProblem()) {
        goTo(stepNames.indexOf("people"));
        setErrors({ people: t(`imports.people.${peopleChoice}.missing`) });
        setPeopleAttempt((count) => count + 1);
        focusFirstInvalidSoon();
        return;
      }
      if (input === "connection" && !entry.connection) {
        goTo(stepNames.indexOf("connection"));
        setErrors({ connection: t("imports.connection.required") });
        setConnectionAttempt((count) => count + 1);
        focusFirstInvalidSoon();
        return;
      }
      if (!reimport && !(await validateSpace())) {
        goTo(stepNames.indexOf("space"));
        focusFirstInvalidSoon();
        return;
      }
      if (entry.state !== "ready") {
        setErrors({ start: t("imports.wizard.check.notReady") });
        return;
      }
      if (!reimport) {
        await patch({ ...formBody(form, input), spaceName: form.spaceName.trim(), spaceKey: form.spaceKey });
      }
      await startImport(entry.id);
      await queryClient.invalidateQueries({ queryKey: importKeys.all });
      await navigate({
        to: "/settings/organizations/$organizationId/imports/$importId",
        params: { organizationId, importId: entry.id },
      });
    } catch (error) {
      setErrors({ start: problemMessage(t, error) });
    } finally {
      setStarting(false);
    }
  };

  const steps = (
    <ol className="flex flex-wrap gap-x-4 gap-y-2" aria-label={t("imports.wizard.steps")}>
      {stepNames.map((name, position) => (
        <li
          key={name}
          aria-current={position === index ? "step" : undefined}
          className={classNames(
            "flex items-center gap-2 font-medium",
            position === index ? "text-text" : "text-text-muted",
          )}
        >
          <span
            className={classNames(
              "flex size-icon-lg items-center justify-center rounded-full border text-xs",
              position < index && "border-transparent bg-success-soft text-success",
              position === index && "border-accent bg-accent text-on-accent",
              position > index && "border-border",
            )}
          >
            {position < index ? <Check aria-hidden="true" className="size-icon-sm" /> : position + 1}
          </span>
          {t(`imports.wizard.stepNames.${name}`)}
        </li>
      ))}
    </ol>
  );

  return (
    <SettingsPage
      title={t(`imports.wizard.stepNames.${step}`)}
      description={
        reimport
          ? t("imports.reimport.wizardProgress", {
              step: index + 1,
              total: stepNames.length,
              space: reimport.name,
            })
          : t("imports.wizard.progress", { step: index + 1, total: stepNames.length })
      }
      icon={FileInput}
      organizationId={organizationId}
      breadcrumbs={[
        { label: t("imports.title"), href: `/settings/organizations/${organizationId}/imports` },
        {
          label: reimport
            ? t("imports.reimport.wizardTitle", { space: reimport.name })
            : importTitle(t, entry),
        },
      ]}
      actions={
        <Button
          variant="secondary"
          onClick={() =>
            void navigate({
              to: "/settings/organizations/$organizationId/imports",
              params: { organizationId },
            })
          }
        >
          {t("imports.wizard.close")}
        </Button>
      }
    >
      {steps}
      <p className="text-sm text-text-muted" aria-live="polite">
        {saving ? t("imports.wizard.saving") : saveError ? "" : t("imports.wizard.saved")}
      </p>
      {saveError ? (
        <Notice
          variant="warning"
          title={t("imports.wizard.saveFailed")}
          action={
            <Button variant="secondary" onClick={() => setForm((current) => ({ ...current }))}>
              {t("errors.retry")}
            </Button>
          }
        >
          {problemMessage(t, saveError)}
        </Notice>
      ) : null}
      {step === "source" ? (
        <SourceStep organizationId={organizationId} entry={entry} patch={patch} fileError={errors.file} />
      ) : null}
      {step === "people" ? (
        <PeopleStep
          entry={entry}
          choice={peopleChoice}
          onChoice={(choice) => {
            setPeopleChoice(choice);
            setErrors({});
          }}
          error={errors.people}
          attempt={peopleAttempt}
        />
      ) : null}
      {step === "connection" ? (
        <ConnectionStep entry={entry} error={errors.connection} attempt={connectionAttempt} />
      ) : null}
      {step === "selection" ? (
        <SelectionStep
          entry={entry}
          selection={selection}
          onChange={(next) => {
            setSelection(next);
            setErrors({});
          }}
          error={errors.selection}
          reimport={Boolean(reimport)}
        />
      ) : null}
      {step === "upload" ? (
        <UploadStep organizationId={organizationId} entry={entry} patch={patch} fileError={errors.file} />
      ) : null}
      {step === "space" ? (
        <SpaceStep
          organizationId={organizationId}
          organizationName={organization?.name ?? null}
          entry={entry}
          form={form}
          setForm={setForm}
          errors={errors}
        />
      ) : null}
      {step === "check" && reimport ? <ReimportCheck entry={entry} space={reimport.name} /> : null}
      {step === "check" && !reimport ? <CheckStep entry={entry} form={form} /> : null}
      {errors.start ? (
        <ErrorState title={t("imports.wizard.check.startFailed")} cause={errors.start} />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {index > 0 ? (
          <Button variant="secondary" icon={ArrowLeft} onClick={() => goTo(index - 1)}>
            {t("imports.wizard.back")}
          </Button>
        ) : null}
        <span className="flex-1" />
        {step === "check" ? (
          <Button variant="primary" loading={starting} onClick={() => void start()}>
            {reimport ? t("imports.reimport.compare") : t("imports.wizard.check.start")}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void next()}>
            {t("imports.wizard.continue")}
          </Button>
        )}
      </div>
      <DangerZone title={t("imports.wizard.danger")}>
        <DangerAction
          title={t("imports.wizard.deleteDraft")}
          description={t("imports.wizard.deleteDraftDescription")}
          action={
            <Button variant="danger" onClick={() => setDeleting(true)}>
              {t("imports.wizard.deleteDraft")}
            </Button>
          }
        />
      </DangerZone>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("imports.wizard.deleteDraftTitle")}
        description={t("imports.wizard.deleteDraftConfirm")}
        confirmLabel={t("imports.wizard.deleteDraft")}
        cancelLabel={t("imports.wizard.keepDraft")}
        destructive
        onConfirm={async () => {
          try {
            await removeImport(entry.id);
            await queryClient.invalidateQueries({ queryKey: importKeys.all });
            await navigate({
              to: "/settings/organizations/$organizationId/imports",
              params: { organizationId },
            });
          } catch (error) {
            failed(t("imports.wizard.deleteFailed"), error);
            throw error;
          }
        }}
      />
    </SettingsPage>
  );
}

function SourceStep({
  organizationId,
  entry,
  patch,
  fileError,
}: {
  organizationId: string;
  entry: ImportView;
  patch: (body: ImportUpdate) => Promise<ImportView>;
  fileError: string | undefined;
}) {
  const { t } = useTranslation();
  const failed = useFailureToast();
  const choose = (source: ImportView["source"]) => {
    if (source === entry.source || (source === "confluence-xml" && entry.source === "confluence-csv")) return;
    void patch({ source }).catch((error: unknown) => failed(t("imports.wizard.saveFailed"), error));
  };
  return (
    <>
      <SourceChoice entry={entry} onChoose={choose} />
      {inputOf(entry.source) === "export" ? (
        <>
          <Section title={t("imports.wizard.source.formatTitle")}>
            <div className="flex flex-col gap-3 p-4">
              <RadioGroup
                label={t("imports.wizard.source.formatTitle")}
                variant="card"
                value={entry.source}
                onValueChange={(value) => choose(value as ImportView["source"])}
                options={(["confluence-xml", "confluence-csv"] as const).map((value) => ({
                  value,
                  label: t(`imports.sources.${value}.label`),
                  description: t(`imports.sources.${value}.description`),
                }))}
              />
              <p className="text-sm text-text-muted">{t("imports.wizard.source.whereToFind")}</p>
            </div>
          </Section>
          <FileSection organizationId={organizationId} entry={entry} patch={patch} fileError={fileError} />
        </>
      ) : null}
    </>
  );
}

function UploadStep({
  organizationId,
  entry,
  patch,
  fileError,
}: {
  organizationId: string;
  entry: ImportView;
  patch: (body: ImportUpdate) => Promise<ImportView>;
  fileError: string | undefined;
}) {
  const { t } = useTranslation();
  const folder = useQuery({ ...folderQuery(organizationId), throwOnError: false });
  const analysis = entry.errorCode ? errorText(t, entry.errorCode) : null;
  if (inputOf(entry.source) === "archive") {
    return (
      <>
        <Notice variant="info" title={t("imports.markdown.title")}>
          {t("imports.markdown.description")}
        </Notice>
        <FileSection organizationId={organizationId} entry={entry} patch={patch} fileError={fileError} />
      </>
    );
  }
  return (
    <>
      <Section title={t("imports.documents.title")}>
        <div className="flex flex-col gap-4 p-4">
          {fileError ? <FieldError>{fileError}</FieldError> : null}
          <DocumentsField
            organizationId={organizationId}
            entry={entry}
            maxBytes={Math.min(folder.data?.maxUploadBytes ?? MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES)}
            patch={patch}
            invalid={Boolean(fileError)}
          />
          <SplitField entry={entry} patch={patch} />
          <p className="text-sm text-text-muted">{t("imports.documents.notes")}</p>
        </div>
      </Section>
      {entry.state === "analyzing" ? <Reading entry={entry} /> : null}
      {analysis ? <ErrorState title={analysis.what} cause={analysis.cause} action={analysis.action} /> : null}
      {entry.state === "ready" && entry.found ? (
        <Notice variant="success" title={t("imports.documents.readTitle")}>
          {t("imports.documents.read", { pages: entry.found.pages, attachments: entry.found.attachments })}
        </Notice>
      ) : null}
    </>
  );
}

function FileSection({
  organizationId,
  entry,
  patch,
  fileError,
}: {
  organizationId: string;
  entry: ImportView;
  patch: (body: ImportUpdate) => Promise<ImportView>;
  fileError: string | undefined;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const folder = useQuery({ ...folderQuery(organizationId), throwOnError: false });
  const [where, setWhere] = useState<"upload" | "folder">(
    entry.file?.kind === "folder" ? "folder" : "upload",
  );
  const failed = useFailureToast();
  const analysis = entry.errorCode ? errorText(t, entry.errorCode) : null;
  return (
    <>
      <Section title={t("imports.wizard.source.fileTitle")}>
        <div className="flex flex-col gap-3 p-4">
          <RadioGroup
            label={t("imports.wizard.source.fileTitle")}
            variant="card"
            value={where}
            onValueChange={(value) => setWhere(value as "upload" | "folder")}
            options={[
              {
                value: "upload",
                label: t("imports.wizard.source.upload"),
                description: folder.data
                  ? t("imports.wizard.source.uploadDescription", {
                      size: format.bytes(folder.data.maxUploadBytes),
                    })
                  : t("imports.wizard.source.uploadDescriptionPlain"),
              },
              {
                value: "folder",
                label: t("imports.wizard.source.folder"),
                description: t("imports.wizard.source.folderDescription"),
              },
            ]}
          />
          {fileError ? <FieldError>{fileError}</FieldError> : null}
          {where === "upload" ? (
            <UploadField
              invalid={Boolean(fileError)}
              organizationId={organizationId}
              current={entry.file?.kind === "upload" ? entry.file : null}
              maxBytes={folder.data?.maxUploadBytes ?? Number.MAX_SAFE_INTEGER}
              folder={folder.data ? { enabled: folder.data.enabled, path: folder.data.path } : null}
              onLinked={async (uploadId) => {
                await patch({ file: { kind: "upload", uploadId } });
              }}
              onComplete={async (uploadId) => {
                await patch({ file: { kind: "upload", uploadId } });
              }}
            />
          ) : (
            <FolderField
              path={folder.data?.path ?? ""}
              files={folder.data?.files ?? []}
              enabled={folder.data?.enabled ?? false}
              loading={folder.isPending}
              error={folder.isError ? folder.error : null}
              onRetry={() => void folder.refetch()}
              invalid={Boolean(fileError)}
              value={entry.file?.kind === "folder" ? entry.file.name : null}
              onChange={(name) =>
                void patch({ file: { kind: "folder", name } }).catch((error: unknown) =>
                  failed(t("imports.wizard.source.folderFailed"), error),
                )
              }
            />
          )}
        </div>
      </Section>
      {entry.state === "analyzing" ? <Reading entry={entry} /> : null}
      {analysis ? <ErrorState title={analysis.what} cause={analysis.cause} action={analysis.action} /> : null}
      {entry.state === "ready" && entry.found ? (
        <Notice variant="success" title={t("imports.wizard.source.readTitle")}>
          {t("imports.wizard.source.read", { pages: entry.found.pages, space: entry.found.spaceName })}
        </Notice>
      ) : null}
    </>
  );
}

function FolderField({
  path,
  files,
  enabled,
  loading,
  error,
  onRetry,
  value,
  onChange,
  invalid,
}: {
  invalid: boolean;
  path: string;
  files: { name: string; size: number }[];
  enabled: boolean;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  value: string | null;
  onChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  if (loading) return <Skeleton className="h-control-field w-full" />;
  if (error)
    return <LoadError what={t("imports.wizard.source.folderLoadFailed")} error={error} onRetry={onRetry} />;
  if (!enabled) {
    return <Notice variant="warning">{t("imports.wizard.source.folderDisabled")}</Notice>;
  }
  return (
    <div className="flex flex-col gap-3">
      <FolderPath path={path} />
      {files.length === 0 ? (
        <Notice variant="info" title={t("imports.wizard.source.folderEmpty")}>
          {t("imports.wizard.source.folderEmptyDescription")}
        </Notice>
      ) : (
        <Field label={t("imports.wizard.source.folderFile")} hint={t("imports.wizard.source.folderHint")}>
          <Select
            value={value ?? ""}
            onValueChange={onChange}
            invalid={invalid}
            placeholder={t("imports.wizard.source.folderPlaceholder")}
            options={files.map((file) => ({
              value: file.name,
              label: t("imports.wizard.source.folderOption", {
                name: file.name,
                size: format.bytes(file.size),
              }),
            }))}
          />
        </Field>
      )}
    </div>
  );
}

function Reading({ entry }: { entry: ImportView }) {
  const percent =
    entry.progress.total > 0
      ? Math.min(100, Math.round((entry.progress.done / entry.progress.total) * 100))
      : 0;
  return (
    <>
      <ThrottleNotice until={entry.throttledUntil} />
      <WaitingNotice spaceKey={entry.waitingFor} />
      <ReadingProgress entry={entry} percent={percent} />
    </>
  );
}

function ReadingProgress({ entry, percent }: { entry: ImportView; percent: number }) {
  const { t } = useTranslation();
  return (
    <Notice variant="info" title={t("imports.wizard.reading")}>
      <div className="flex flex-col gap-2">
        <span>
          {t(
            inputOf(entry.source) === "connection"
              ? "imports.wizard.readingConnection"
              : "imports.wizard.readingDescription",
          )}
        </span>
        <div
          role="progressbar"
          aria-label={t("imports.wizard.reading")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 overflow-hidden rounded-full bg-surface"
        >
          <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </Notice>
  );
}

function SpaceStep({
  organizationId,
  organizationName,
  entry,
  form,
  setForm,
  errors,
}: {
  organizationId: string;
  organizationName: string | null;
  entry: ImportView;
  form: Form;
  setForm: (update: (current: Form) => Form) => void;
  errors: Partial<Record<string, string>>;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const failed = useFailureToast();
  const input = inputOf(entry.source);
  const [busy, setBusy] = useState(false);
  const changeReviewers = async (ids: string[]) => {
    setBusy(true);
    try {
      const updated = await setReviewers(entry.id, ids);
      queryClient.setQueryData(importKeys.detail(entry.id), updated);
    } catch (error) {
      failed(t("imports.wizard.space.reviewersFailed"), error, () => void changeReviewers(ids));
    } finally {
      setBusy(false);
    }
  };
  const reviewerIds = entry.reviewers.map((reviewer) => reviewer.id);
  return (
    <>
      {entry.state === "analyzing" ? <Reading entry={entry} /> : null}
      <Section title={t("imports.wizard.space.title")}>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <Field
            label={t("imports.wizard.space.name")}
            {...(errors.spaceName ? { error: errors.spaceName } : {})}
          >
            <Input
              value={form.spaceName}
              maxLength={100}
              onChange={(event) => {
                const value = event.target.value;
                setForm((current) => ({ ...current, spaceName: value }));
              }}
            />
          </Field>
          <Field
            label={t("imports.wizard.space.key")}
            hint={t("imports.wizard.space.keyHint")}
            {...(errors.spaceKey ? { error: errors.spaceKey } : {})}
          >
            <Input
              value={form.spaceKey}
              maxLength={10}
              spellCheck={false}
              autoCapitalize="characters"
              className="font-mono"
              onChange={(event) => {
                const value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
                setForm((current) => ({ ...current, spaceKey: value }));
              }}
            />
          </Field>
          {input === "export" || input === "connection" ? (
            <div className="md:col-span-2">
              <Field
                label={t("imports.wizard.space.sourceUrl")}
                hint={t("imports.wizard.space.sourceUrlHint")}
                {...(errors.sourceUrl ? { error: errors.sourceUrl } : {})}
              >
                <Input
                  value={form.sourceUrl}
                  type="url"
                  inputMode="url"
                  placeholder={t("imports.wizard.space.sourceUrlPlaceholder")}
                  onChange={(event) => {
                    const value = event.target.value;
                    setForm((current) => ({ ...current, sourceUrl: value }));
                  }}
                />
              </Field>
            </div>
          ) : null}
        </div>
      </Section>
      <Section title={t("imports.wizard.space.whatTitle")}>
        {input === "export" ? (
          <div className="flex flex-col gap-3 p-4">
            <RadioGroup
              label={t("imports.wizard.space.whatTitle")}
              variant="card"
              value={form.history ? "full" : "current"}
              onValueChange={(value) => setForm((current) => ({ ...current, history: value === "full" }))}
              options={(["current", "full"] as const).map((value) => ({
                value,
                label: t(`imports.wizard.space.history.${value}`),
                description: t(`imports.wizard.space.history.${value}Description`),
              }))}
            />
          </div>
        ) : null}
        <div
          className={classNames(
            "flex flex-wrap items-center gap-3 p-4",
            input === "export" && "border-t border-border",
          )}
        >
          <div className="flex min-w-0 flex-1 basis-field flex-col">
            <span className="font-medium">{t("imports.wizard.space.archived")}</span>
            <span className="text-sm text-text-muted">{t("imports.wizard.space.archivedDescription")}</span>
          </div>
          <Switch
            label={t("imports.wizard.space.archived")}
            labelHidden
            checked={form.archived}
            onCheckedChange={(archived) => setForm((current) => ({ ...current, archived }))}
          />
        </div>
      </Section>
      <Section title={t("imports.wizard.space.reviewers")}>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-sm text-text-muted">{t("imports.wizard.space.reviewersHint")}</p>
          {entry.reviewers.length > 0 ? (
            <ul className="flex flex-col gap-2" aria-busy={busy}>
              {entry.reviewers.map((reviewer) => (
                <li key={reviewer.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={reviewer.name}>
                    {reviewer.name}
                  </span>
                  <IconButton
                    label={t("imports.wizard.space.removeReviewer", { name: reviewer.name })}
                    icon={X}
                    onClick={() => void changeReviewers(reviewerIds.filter((id) => id !== reviewer.id))}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <Field label={t("imports.wizard.space.addReviewer")}>
            <HolderPicker
              label={t("imports.wizard.space.addReviewer")}
              organizationId={organizationId}
              organizationName={organizationName}
              personal={false}
              peopleOnly
              exclude={[...reviewerIds.map((id) => `account:${id}`), `account:${entry.importer.id}`]}
              value={null}
              onValueChange={(holder) => {
                if (holder?.principalKind === "account" && holder.principalId) {
                  void changeReviewers([...reviewerIds, holder.principalId]);
                }
              }}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

function ReimportCheck({ entry, space }: { entry: ImportView; space: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  if (entry.state === "analyzing") return <Reading entry={entry} />;
  const found = entry.found;
  if (!found) return <Notice variant="warning">{t("imports.wizard.check.notRead")}</Notice>;
  return (
    <>
      <p className="text-sm text-text-muted">{t("imports.reimport.checkIntro", { space })}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(
          [
            [found.pages, "imports.wizard.check.pages"],
            [found.blogPosts, "imports.wizard.check.blogPosts"],
            [found.comments, "imports.wizard.check.comments"],
            [found.people, "imports.wizard.check.peopleCount"],
          ] as const
        ).map(([value, key]) => (
          <div key={key} className="flex flex-col gap-1 rounded-md border border-border p-4">
            <span className="text-xl font-semibold tabular-nums">{format.number(value)}</span>
            <span className="text-sm text-text-muted">{t(key, { count: value })}</span>
          </div>
        ))}
      </div>
      <Notice variant="info" title={t("imports.reimport.checkNoticeTitle")}>
        {t("imports.reimport.checkNotice")}
      </Notice>
    </>
  );
}

function CheckStep({ entry, form }: { entry: ImportView; form: Form }) {
  const { t } = useTranslation();
  const format = useFormat();
  if (entry.state === "analyzing") return <Reading entry={entry} />;
  const found = entry.found;
  if (!found) {
    return <Notice variant="warning">{t("imports.wizard.check.notRead")}</Notice>;
  }
  const stat = (value: string, label: string) => (
    <div className="flex flex-col gap-1 rounded-md border border-border p-4">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-text-muted">{label}</span>
    </div>
  );
  const reviewers = entry.reviewers.map((reviewer) => reviewer.name);
  const input = inputOf(entry.source);
  const files = input === "archive" || input === "documents";
  const history = input === "export" ? form.history : entry.history;
  const attachments = stat(
    format.number(found.attachments),
    t("imports.wizard.check.attachments", {
      count: found.attachments,
      size: format.bytes(found.attachmentBytes),
    }),
  );
  const space = (
    <li className="flex flex-col gap-1 px-4 py-3">
      <span className="font-medium">
        {t("imports.wizard.check.spaceTitle", { name: form.spaceName, key: form.spaceKey })}
      </span>
      <span className="text-sm text-text-muted">
        {t(form.archived ? "imports.wizard.check.archived" : "imports.wizard.check.notArchived", {
          count: reviewers.length,
        })}
      </span>
    </li>
  );
  const quarantine = (
    <Notice variant="info" title={t("imports.wizard.check.quarantineTitle")}>
      {reviewers.length > 0
        ? t("imports.wizard.check.quarantineWithReviewers", { names: reviewers.join(", ") })
        : t("imports.wizard.check.quarantineAlone")}
    </Notice>
  );
  if (files) {
    return (
      <>
        <p className="text-sm text-text-muted">{t("imports.wizard.check.introFiles")}</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stat(format.number(found.pages), t("imports.wizard.check.pages", { count: found.pages }))}
          {attachments}
        </div>
        <Section title={t("imports.wizard.check.foundTitle")}>
          <ul className="flex flex-col divide-y divide-border">
            <li className="flex flex-col gap-1 px-4 py-3">
              <span className="font-medium">
                {t(
                  input === "archive"
                    ? "imports.wizard.check.markdownTitle"
                    : "imports.wizard.check.wordTitle",
                )}
              </span>
              <span className="text-sm text-text-muted">
                {t(
                  input === "archive"
                    ? "imports.wizard.check.markdownDescription"
                    : "imports.wizard.check.wordDescription",
                )}
              </span>
            </li>
            {space}
          </ul>
        </Section>
        {quarantine}
      </>
    );
  }
  const peopleBy = input === "connection" && entry.peopleSource?.kind === "source" ? "source" : null;
  return (
    <>
      <p className="text-sm text-text-muted">
        {t(input === "connection" ? "imports.wizard.check.introConnection" : "imports.wizard.check.intro")}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stat(format.number(found.pages), t("imports.wizard.check.pages", { count: found.pages }))}
        {stat(
          format.number(found.blogPosts),
          t("imports.wizard.check.blogPosts", { count: found.blogPosts }),
        )}
        {attachments}
        {stat(format.number(found.comments), t("imports.wizard.check.comments", { count: found.comments }))}
      </div>
      <Section title={t("imports.wizard.check.foundTitle")}>
        <ul className="flex flex-col divide-y divide-border">
          <li className="flex flex-col gap-1 px-4 py-3">
            <span className="font-medium">
              {t("imports.wizard.check.peopleTitle", { count: found.people })}
            </span>
            <span className="text-sm text-text-muted">
              {t(
                `imports.wizard.check.peopleBy.${peopleBy ?? (entry.peopleSource?.kind as "token" | "list" | "skip" | undefined) ?? "skip"}`,
              )}
            </span>
          </li>
          <li className="flex flex-col gap-1 px-4 py-3">
            <span className="font-medium">
              {t(history ? "imports.wizard.check.historyFull" : "imports.wizard.check.historyCurrent", {
                count: found.versions,
              })}
            </span>
            <span className="text-sm text-text-muted">
              {t("imports.wizard.check.extras", { likes: found.likes, watchers: found.watchers })}
            </span>
          </li>
          <li className="flex flex-col gap-1 px-4 py-3">
            <span className="font-medium">{t("imports.wizard.check.permissionsTitle")}</span>
            <span className="text-sm text-text-muted">
              {t("imports.wizard.check.permissionsDescription")}
            </span>
          </li>
          <li className="flex flex-col gap-1 px-4 py-3">
            <span className="font-medium">
              {t("imports.wizard.check.macrosTitle", { count: found.macroKinds })}
            </span>
            <span className="text-sm text-text-muted">{t("imports.wizard.check.macrosDescription")}</span>
          </li>
          {space}
        </ul>
      </Section>
      {quarantine}
    </>
  );
}
