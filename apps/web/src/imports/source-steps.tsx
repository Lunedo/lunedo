import {
  Badge,
  Button,
  Checkbox,
  classNames,
  ErrorState,
  Field,
  FieldError,
  focusFirstInvalidSoon,
  Icon,
  IconButton,
  Input,
  Notice,
  PasswordInput,
  RadioGroup,
  Section,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError, useFailureToast } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import {
  type ConnectionBody,
  connectionSpacesQuery,
  connectionTreeQuery,
  type ImportUpdate,
  type ImportView,
  importKeys,
  setConnection,
} from "./imports-api.js";
import { createUpload, getUpload, type UploadProgress, uploadParts } from "./upload.js";

export type Source = ImportView["source"];
export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export type StepName = "source" | "people" | "connection" | "selection" | "upload" | "space" | "check";
export type SourceInput = "export" | "connection" | "archive" | "documents";

export function inputOf(source: Source): SourceInput {
  if (source === "confluence-cloud" || source === "confluence-dc") return "connection";
  if (source === "markdown") return "archive";
  if (source === "word") return "documents";
  return "export";
}

export function stepsFor(source: Source, reimport: boolean): readonly StepName[] {
  const input = inputOf(source);
  const middle: StepName[] =
    input === "export" ? ["people"] : input === "connection" ? ["connection", "selection"] : ["upload"];
  return ["source", ...middle, ...(reimport ? [] : (["space"] as const)), "check"];
}

type KindName = "confluence-xml" | "confluence-cloud" | "confluence-dc" | "markdown" | "word";
const CONFLUENCE: readonly KindName[] = ["confluence-xml", "confluence-cloud", "confluence-dc"];
const FILES: readonly KindName[] = ["markdown", "word"];

export function SourceChoice({ source, onChoose }: { source: Source; onChoose: (source: Source) => void }) {
  const { t } = useTranslation();
  const chosen: Source = source === "confluence-csv" ? "confluence-xml" : source;
  const group = (title: string, sources: readonly KindName[]) => (
    <Section title={title}>
      <div className="p-4">
        <RadioGroup
          label={title}
          variant="card"
          value={(sources as readonly string[]).includes(chosen) ? chosen : ""}
          onValueChange={(value) => onChoose(value as Source)}
          options={sources.map((value) => ({
            value,
            label: t(`imports.wizard.kinds.${value}.label`),
            description: t(`imports.wizard.kinds.${value}.description`),
          }))}
        />
      </div>
    </Section>
  );
  return (
    <>
      {group(t("imports.wizard.kinds.fromConfluence"), CONFLUENCE)}
      {group(t("imports.wizard.kinds.fromFiles"), FILES)}
    </>
  );
}

export function ThrottleNotice({ until }: { until: string | null }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const end = until ? Date.parse(until) : 0;
  useEffect(() => {
    if (end <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [end]);
  if (end <= now) return null;
  return (
    <Notice variant="warning" title={t("imports.throttled.title")}>
      {t("imports.throttled.description", { seconds: Math.max(1, Math.ceil((end - now) / 1000)) })}
    </Notice>
  );
}

type ConnectionProblems = { site?: string; email?: string; token?: string; baseUrl?: string };

export function ConnectionStep({
  entry,
  error,
  attempt,
}: {
  entry: ImportView;
  error: string | undefined;
  attempt: number;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const cloud = entry.source === "confluence-cloud";
  const connected = entry.connection;
  const [editing, setEditing] = useState(connected === null);
  const [site, setSite] = useState(connected?.site ?? "");
  const [email, setEmail] = useState(connected?.email ?? "");
  const [baseUrl, setBaseUrl] = useState(
    connected && !cloud ? `https://${connected.site}${connected.basePath}` : "",
  );
  const [token, setToken] = useState("");
  const [certificates, setCertificates] = useState("");
  const [errors, setErrors] = useState<ConnectionProblems>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [seenAttempt, setSeenAttempt] = useState(attempt);

  const problems = (): ConnectionProblems => {
    const next: ConnectionProblems = {};
    if (cloud) {
      if (!site.trim()) next.site = t("imports.connection.siteRequired");
      if (!/^[^\s@]+@[^\s@]+$/.test(email.trim())) next.email = t("imports.connection.emailInvalid");
    } else if (!/^(https:\/\/)?[^\s/]+(\/\S*)?$/i.test(baseUrl.trim())) {
      next.baseUrl = t("imports.connection.baseUrlInvalid");
    }
    if (!token.trim()) next.token = t("imports.connection.tokenRequired");
    return next;
  };

  if (seenAttempt !== attempt) {
    setSeenAttempt(attempt);
    if (editing) setErrors(problems());
  }

  const check = async () => {
    const next = problems();
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    setChecking(true);
    const body: ConnectionBody = cloud
      ? { kind: "cloud", site: site.trim(), email: email.trim(), token: token.trim() }
      : {
          kind: "dataCenter",
          baseUrl: baseUrl.trim(),
          token: token.trim(),
          caCertificates: certificates.trim() || null,
        };
    try {
      const updated = await setConnection(entry.id, body);
      queryClient.setQueryData(importKeys.detail(entry.id), updated);
      setToken("");
      setEditing(false);
    } catch (problem) {
      setFailure(problem);
    } finally {
      setChecking(false);
    }
  };

  const deleted = !connected && entry.tokenDeletedAt;
  return (
    <Section title={t(cloud ? "imports.connection.cloudTitle" : "imports.connection.dataCenterTitle")}>
      <div className="flex flex-col gap-4 p-4">
        {error ? <FieldError>{error}</FieldError> : null}
        {deleted && entry.tokenDeletedAt ? (
          <Notice variant="warning" title={t("imports.connection.deletedTitle")}>
            {t("imports.connection.deleted", { when: format.dateTime(entry.tokenDeletedAt) })}
          </Notice>
        ) : null}
        {connected && !editing ? (
          <Notice
            variant="success"
            title={t("imports.connection.connected", {
              site: `${connected.site}${connected.basePath}`,
            })}
            action={
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t("imports.connection.change")}
              </Button>
            }
          >
            {connected.account
              ? t(cloud ? "imports.connection.asCloud" : "imports.connection.asDataCenter", {
                  name: connected.account,
                })
              : t("imports.connection.connectedPlain")}
          </Notice>
        ) : (
          <form
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void check();
            }}
          >
            {cloud ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={t("imports.connection.site")}
                  hint={t("imports.connection.siteHint")}
                  {...(errors.site ? { error: errors.site } : {})}
                >
                  <Input
                    value={site}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder={t("imports.connection.sitePlaceholder")}
                    onChange={(event) => setSite(event.target.value)}
                  />
                </Field>
                <Field
                  label={t("imports.connection.email")}
                  {...(errors.email ? { error: errors.email } : {})}
                >
                  <Input
                    type="email"
                    value={email}
                    autoComplete="off"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <Field
                label={t("imports.connection.baseUrl")}
                hint={t("imports.connection.baseUrlHint")}
                {...(errors.baseUrl ? { error: errors.baseUrl } : {})}
              >
                <Input
                  value={baseUrl}
                  type="url"
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={t("imports.connection.baseUrlPlaceholder")}
                  onChange={(event) => setBaseUrl(event.target.value)}
                />
              </Field>
            )}
            <Field
              label={t(cloud ? "imports.connection.apiToken" : "imports.connection.accessToken")}
              hint={t(cloud ? "imports.connection.apiTokenHint" : "imports.connection.accessTokenHint")}
              {...(errors.token ? { error: errors.token } : {})}
            >
              <PasswordInput
                value={token}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                onChange={(event) => setToken(event.target.value)}
              />
            </Field>
            {cloud ? null : (
              <details className="rounded-md border border-border">
                <summary className="flex min-h-hit cursor-pointer items-center rounded-md px-4 py-2 font-medium focus-visible:focus-ring">
                  {t("imports.connection.advanced")}
                </summary>
                <div className="border-t border-border p-4">
                  <Field
                    label={t("imports.connection.certificates")}
                    hint={t("imports.connection.certificatesHint")}
                  >
                    <Textarea
                      rows={6}
                      value={certificates}
                      spellCheck={false}
                      className="font-mono"
                      placeholder={t("imports.connection.certificatesPlaceholder")}
                      onChange={(event) => setCertificates(event.target.value)}
                    />
                  </Field>
                </div>
              </details>
            )}
            <p className="text-sm text-text-muted">{t("imports.connection.readOnly")}</p>
            {failure ? (
              <ErrorState
                title={t("imports.connection.checkFailed")}
                cause={problemMessage(t, failure)}
                action={t("imports.connection.checkFailedAction")}
              />
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {connected ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditing(false);
                    setToken("");
                    setErrors({});
                    setFailure(null);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              ) : null}
              <Button type="submit" variant="primary" loading={checking}>
                {t("imports.connection.test")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Section>
  );
}

export interface Selection {
  spaceKeys: string[];
  pageIds: string[] | null;
  blogPosts: boolean;
  history: boolean;
}

export function selectionOf(entry: ImportView): Selection {
  const chosen = entry.connection?.selection.map((item) => item.spaceKey) ?? [];
  const own = entry.options.spaceKey;
  return {
    spaceKeys: own && !chosen.includes(own) ? [own, ...chosen] : chosen,
    pageIds: entry.options.pageIds ? [...entry.options.pageIds] : null,
    blogPosts: entry.options.blogPosts ?? true,
    history: entry.history,
  };
}

export function ownSpaceOf(entry: ImportView, selection: Selection): string | null {
  const current = entry.options.spaceKey;
  return current && selection.spaceKeys.includes(current) ? current : (selection.spaceKeys[0] ?? null);
}

const SPACE_FILTER_FROM = 10;

export function WaitingNotice({ spaceKey }: { spaceKey: string | null }) {
  const { t } = useTranslation();
  if (!spaceKey) return null;
  return (
    <Notice variant="info" title={t("imports.waiting.title")}>
      {t("imports.waiting.description", { key: spaceKey })}
    </Notice>
  );
}

export function SelectionStep({
  entry,
  selection,
  onChange,
  error,
  reimport,
}: {
  entry: ImportView;
  selection: Selection;
  onChange: (selection: Selection) => void;
  error: string | undefined;
  reimport: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [filter, setFilter] = useState("");
  const site = entry.connection?.site ?? "";
  const own = ownSpaceOf(entry, selection);
  const spaces = useQuery({ ...connectionSpacesQuery(entry.id, site), enabled: Boolean(entry.connection) });
  const tree = useQuery({
    ...connectionTreeQuery(entry.id, site, own ?? ""),
    enabled: Boolean(entry.connection && own),
  });
  if (!entry.connection) {
    return <Notice variant="warning">{t("imports.selection.notConnected")}</Notice>;
  }
  const chosen = new Set(selection.pageIds ?? tree.data?.trees.map((entry) => entry.id) ?? []);
  const toggle = (id: string, on: boolean) => {
    const all = tree.data?.trees.map((item) => item.id) ?? [];
    const next = new Set(selection.pageIds ?? all);
    if (on) next.add(id);
    else next.delete(id);
    onChange({ ...selection, pageIds: next.size === all.length ? null : [...next] });
  };
  const choose = (key: string, on: boolean) => {
    const keys = reimport
      ? on
        ? [key]
        : []
      : on
        ? [...selection.spaceKeys.filter((item) => item !== key), key]
        : selection.spaceKeys.filter((item) => item !== key);
    const ownAfter = ownSpaceOf(entry, { ...selection, spaceKeys: keys });
    onChange({ ...selection, spaceKeys: keys, ...(ownAfter === own ? {} : { pageIds: null }) });
  };
  const needle = filter.trim().toLowerCase();
  const listed = (spaces.data ?? []).filter(
    (space) =>
      needle.length === 0 ||
      space.name.toLowerCase().includes(needle) ||
      space.key.toLowerCase().includes(needle) ||
      selection.spaceKeys.includes(space.key),
  );
  const ownName = spaces.data?.find((space) => space.key === own)?.name || own;
  return (
    <>
      <p className="text-sm text-text-muted">{t("imports.selection.intro")}</p>
      <Section title={t("imports.selection.spaceTitle")}>
        <div className="flex flex-col gap-3 p-4">
          {spaces.isPending ? <Skeleton className="h-control-field w-full" /> : null}
          {spaces.isError ? (
            <LoadError
              what={t("imports.selection.spacesFailed")}
              error={spaces.error}
              onRetry={() => void spaces.refetch()}
            />
          ) : null}
          {spaces.data ? (
            <>
              {spaces.data.length > SPACE_FILTER_FROM ? (
                <Field label={t("imports.selection.filter")}>
                  <Input
                    type="search"
                    value={filter}
                    placeholder={t("imports.selection.filterPlaceholder")}
                    onChange={(event) => setFilter(event.target.value)}
                  />
                </Field>
              ) : null}
              <p className="text-sm text-text-muted">
                {t(reimport ? "imports.selection.spaceHintReimport" : "imports.selection.spacesHint", {
                  count: spaces.data.length,
                })}
              </p>
              {spaces.data.length === 0 ? (
                <p className="text-sm text-text-muted">{t("imports.selection.noSpacesReadable")}</p>
              ) : listed.length === 0 ? (
                <p className="text-sm text-text-muted">{t("imports.selection.noSpaces")}</p>
              ) : (
                <ul
                  aria-label={t("imports.selection.space")}
                  className="flex max-h-96 flex-col gap-2 overflow-y-auto"
                >
                  {listed.map((space) => (
                    <li key={space.key}>
                      <Checkbox
                        checked={selection.spaceKeys.includes(space.key)}
                        onCheckedChange={(checked) => choose(space.key, checked === true)}
                        label={space.name || space.key}
                        description={
                          space.personal
                            ? t("imports.selection.personalSpace", { key: space.key })
                            : space.key
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
              {error ? <FieldError>{error}</FieldError> : null}
              {selection.spaceKeys.length > 1 ? (
                <Notice
                  variant="info"
                  title={t("imports.selection.severalTitle", { count: selection.spaceKeys.length })}
                >
                  {t("imports.selection.severalDescription")}
                </Notice>
              ) : null}
            </>
          ) : null}
        </div>
      </Section>
      {own ? (
        <Section
          title={
            selection.spaceKeys.length > 1
              ? t("imports.selection.treesOfTitle", { name: ownName })
              : t("imports.selection.treesTitle")
          }
        >
          <div className="flex flex-col gap-3 p-4">
            {tree.isPending ? <Skeleton className="h-control-field w-full" /> : null}
            {tree.isError ? (
              <LoadError
                what={t("imports.selection.treeFailed")}
                error={tree.error}
                onRetry={() => void tree.refetch()}
              />
            ) : null}
            {selection.spaceKeys.length > 1 ? (
              <p className="text-sm text-text-muted">{t("imports.selection.treesOfHint")}</p>
            ) : null}
            {tree.data ? (
              <>
                <p className="text-sm text-text-muted">
                  {t(tree.data.complete ? "imports.selection.totals" : "imports.selection.totalsAtLeast", {
                    pages: tree.data.pages,
                    blogPosts: tree.data.blogPosts,
                    size: format.bytes(tree.data.attachmentBytes),
                  })}
                </p>
                {tree.data.trees.length === 0 ? (
                  <p className="text-sm text-text-muted">{t("imports.selection.noTrees")}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {tree.data.trees.map((item) => (
                      <li key={item.id}>
                        <Checkbox
                          checked={chosen.has(item.id)}
                          onCheckedChange={(checked) => toggle(item.id, checked === true)}
                          label={item.title || t("imports.selection.untitled")}
                          description={t("imports.selection.treeSize", {
                            pages: item.pages,
                            size: format.bytes(item.attachmentBytes),
                          })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <Checkbox
                  checked={selection.blogPosts && selection.pageIds === null}
                  disabled={selection.pageIds !== null}
                  onCheckedChange={(checked) => onChange({ ...selection, blogPosts: checked === true })}
                  label={t("imports.selection.blogPosts", { count: tree.data.blogPosts })}
                  description={
                    selection.pageIds !== null
                      ? t("imports.selection.blogPostsWithTrees")
                      : t("imports.selection.blogPostsHint")
                  }
                />
                <p className="text-sm text-text-muted">{t("imports.selection.restricted")}</p>
              </>
            ) : null}
          </div>
        </Section>
      ) : null}
      {reimport ? null : (
        <Section title={t("imports.selection.optionsTitle")}>
          <div className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex min-w-0 flex-1 basis-field flex-col">
              <span className="font-medium">{t("imports.selection.history")}</span>
              <span className="text-sm text-text-muted">{t("imports.selection.historyHint")}</span>
            </div>
            <Switch
              label={t("imports.selection.history")}
              labelHidden
              checked={selection.history}
              onCheckedChange={(history) => onChange({ ...selection, history })}
            />
          </div>
        </Section>
      )}
    </>
  );
}

type DocumentStatus = { file: File; name: string; progress: UploadProgress | null; error: unknown };

export function DocumentsField({
  organizationId,
  entry,
  maxBytes,
  patch,
  invalid,
}: {
  organizationId: string;
  entry: ImportView;
  maxBytes: number;
  patch: (body: ImportUpdate) => Promise<ImportView>;
  invalid: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const failed = useFailureToast();
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const [busy, setBusy] = useState<Record<string, DocumentStatus>>({});
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const files = useRef(entry.files.map((file) => file.uploadId ?? "").filter(Boolean));
  files.current = entry.files.map((file) => file.uploadId ?? "").filter(Boolean);
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  const save = async (ids: string[]) => {
    files.current = ids;
    await patch({ files: ids });
  };

  const upload = async (file: File) => {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    const controller = new AbortController();
    controllers.current.set(key, controller);
    setBusy((current) => ({ ...current, [key]: { file, name: file.name, progress: null, error: null } }));
    try {
      const existing = entry.files.find(
        (candidate) => !candidate.complete && candidate.name === file.name && candidate.size === file.size,
      );
      const created =
        existing?.uploadId !== undefined && existing.uploadId !== null
          ? await getUpload(organizationId, existing.uploadId)
          : await createUpload(organizationId, file);
      if (!files.current.includes(created.id)) await save([...files.current, created.id]);
      await uploadParts({
        organizationId,
        file,
        upload: created,
        signal: controller.signal,
        onProgress: (progress) =>
          setBusy((current) => ({ ...current, [key]: { file, name: file.name, progress, error: null } })),
      });
      await save([...files.current]);
      setBusy((current) => {
        const { [key]: _done, ...rest } = current;
        return rest;
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setBusy((current) => ({ ...current, [key]: { file, name: file.name, progress: null, error } }));
    } finally {
      controllers.current.delete(key);
    }
  };

  const choose = (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    const wrong = chosen.filter((file) => !/\.docx$/i.test(file.name) || file.size > maxBytes);
    setRefused(wrong.map((file) => file.name));
    for (const file of chosen) if (!wrong.includes(file)) void upload(file);
  };

  const remove = async (uploadId: string) => {
    try {
      await save(files.current.filter((id) => id !== uploadId));
    } catch (error) {
      failed(t("imports.documents.removeFailed"), error, () => void remove(uploadId));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        className={classNames(
          "flex cursor-pointer flex-wrap items-center gap-3 rounded-md border-2 border-dashed bg-surface-sunken p-4 focus-within:focus-ring",
          dragging ? "border-accent bg-accent-soft" : invalid ? "border-danger" : "border-border",
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files);
        }}
      >
        <Icon icon={Upload} className="text-text-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium">{t("imports.documents.drop")}</span>
          <span id={hintId} className="text-sm text-text-muted">
            {t("imports.documents.hint", { size: format.bytes(maxBytes) })}
          </span>
        </span>
        <span className="font-medium text-accent">{t("imports.documents.choose")}</span>
        <input
          id={inputId}
          type="file"
          multiple
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-describedby={hintId}
          {...(invalid ? { "aria-invalid": true } : {})}
          className="sr-only"
          onChange={(event) => {
            choose(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {refused.length > 0 ? (
        <ErrorState
          title={t("imports.documents.refused", { count: refused.length, names: refused.join(", ") })}
          cause={t("imports.documents.refusedCause", { size: format.bytes(maxBytes) })}
          action={t("imports.documents.refusedAction")}
        />
      ) : null}
      <ul className="flex flex-col gap-2">
        {entry.files
          .filter((file) => file.complete || !Object.values(busy).some((status) => status.name === file.name))
          .map((file) => (
            <li
              key={file.uploadId}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
            >
              <Icon icon={FileText} className="text-text-muted" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium" title={file.name}>
                  {file.name}
                </span>
                <span className="text-sm text-text-muted">
                  {file.complete
                    ? t("imports.upload.uploaded", { size: format.bytes(file.size ?? 0) })
                    : t("imports.documents.incomplete")}
                </span>
              </div>
              {file.complete ? (
                <Badge variant="success">
                  <Icon icon={CheckCircle2} size="sm" />
                  {t("imports.upload.done")}
                </Badge>
              ) : null}
              <IconButton
                label={t("imports.documents.remove", { name: file.name })}
                icon={X}
                onClick={() => void remove(file.uploadId ?? "")}
              />
            </li>
          ))}
        {Object.entries(busy).map(([key, status]) => (
          <li key={key} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <span className="truncate font-medium" title={status.name}>
              {status.name}
            </span>
            {status.error ? (
              <ErrorState
                title={t("imports.upload.failed", { name: status.name })}
                cause={problemMessage(t, status.error)}
                action={t("imports.upload.failedAction")}
                onRetry={() => void upload(status.file)}
                retryLabel={t("imports.upload.retry")}
              />
            ) : (
              <span className="text-sm text-text-muted" aria-live="polite">
                {status.progress
                  ? t("imports.upload.progress", {
                      sent: format.bytes(status.progress.sent),
                      total: format.bytes(status.progress.total),
                    })
                  : t("imports.upload.checking")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SplitField({
  entry,
  patch,
}: {
  entry: ImportView;
  patch: (body: ImportUpdate) => Promise<ImportView>;
}) {
  const { t } = useTranslation();
  const failed = useFailureToast();
  return (
    <Field label={t("imports.documents.split")} hint={t("imports.documents.splitHint")}>
      <Select
        value={entry.options.split ?? "file"}
        onValueChange={(value) =>
          void patch({ options: { split: value as "file" | "heading" } }).catch((error: unknown) =>
            failed(t("imports.wizard.saveFailed"), error),
          )
        }
        options={(["file", "heading"] as const).map((value) => ({
          value,
          label: t(`imports.documents.splitOptions.${value}`),
        }))}
      />
    </Field>
  );
}
