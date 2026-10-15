import {
  Badge,
  type BadgeVariant,
  Button,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  PasswordInput,
  Section,
  SettingRow,
  Skeleton,
  Textarea,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceKeys, type StorageStatus, storageQuery } from "../../api/instance-queries.js";
import { ApiError, request } from "../../api/request.js";
import { SaveIndicator, useSaveState } from "../../components/auto-save.js";
import { SettingsList } from "../../components/settings-list.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { useInstanceSettingsEditor } from "./general-screen.js";

const REFRESH_MS = 60_000;
const BYTES_PER_GB = 1024 ** 3;
const LEVEL_BADGES: Record<number, BadgeVariant> = { 0: "success", 1: "warning", 2: "warning", 3: "danger" };
const BAR_COLORS: Record<number, string> = {
  0: "bg-accent",
  1: "bg-warning",
  2: "bg-warning",
  3: "bg-danger",
};
interface Change {
  thresholds?: { warning?: number; largeWrites?: number; critical?: number };
  s3LimitBytes?: number | null;
  operationsEmails?: string[];
  teamsWebhook?: string | null;
}

function useStorageSave() {
  const queryClient = useQueryClient();
  return async (body: Change): Promise<StorageStatus> => {
    const saved = await request(() => api.PUT("/api/v1/instance/storage", { body }));
    queryClient.setQueryData<StorageStatus>(instanceKeys.storage, saved);
    return saved;
  };
}

function storageProblem(t: ReturnType<typeof useTranslation>["t"], failure: unknown): string {
  if (failure instanceof ApiError && failure.code === "invalidStorageSettings") {
    const kind = failure.problem.problem;
    if (
      kind === "invalidContacts" ||
      kind === "invalidTeamsWebhook" ||
      kind === "invalidThresholds" ||
      kind === "invalidS3Limit"
    ) {
      return translateKey(t, `storage.contacts.errors.${kind}`);
    }
  }
  return problemMessage(t, failure);
}

function UsageSection({ status }: { status: StorageStatus }) {
  const { t } = useTranslation();
  const format = useFormat();
  const level = status.level;
  return (
    <Section title={t("storage.usage.title")}>
      <SettingRow
        label={t("storage.usage.store")}
        control={<span>{translateKey(t, `storage.usage.stores.${status.store}`)}</span>}
      />
      {status.measured &&
      status.usedBytes !== null &&
      status.totalBytes !== null &&
      status.percent !== null ? (
        <div className="flex flex-col gap-2 px-4 py-3">
          <p className="font-medium">
            {t("storage.usage.summary", {
              used: format.bytes(status.usedBytes),
              total: format.bytes(status.totalBytes),
              percent: format.percent(status.percent / 100),
            })}
          </p>
          <div
            role="progressbar"
            aria-label={t("storage.usage.progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(status.percent))}
            className="h-2 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className={`h-full transition-[width] motion-reduce:transition-none ${BAR_COLORS[level] ?? "bg-accent"}`}
              style={{ width: `${Math.min(100, status.percent)}%` }}
            />
          </div>
        </div>
      ) : (
        <div className="px-4 py-3">
          <Notice variant="info" title={t("storage.usage.inactiveTitle")}>
            {t("storage.usage.inactiveNoLimit")}
          </Notice>
        </div>
      )}
      {status.measured ? (
        <SettingRow
          label={t("storage.usage.status")}
          description={
            status.checkedAt
              ? t("storage.usage.checked", { time: format.relative(status.checkedAt) })
              : t("storage.usage.notChecked")
          }
          control={
            <Badge variant={LEVEL_BADGES[level] ?? "neutral"}>
              {translateKey(t, `storage.usage.levels.${level}`)}
            </Badge>
          }
        />
      ) : null}
    </Section>
  );
}

function parsePercent(value: string): number | null {
  const cleaned = value.trim();
  if (!/^\d{1,3}$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return parsed >= 1 && parsed <= 100 ? parsed : null;
}

const LEVEL_FIELDS = ["warning", "largeWrites", "critical"] as const;

function LevelsSection({ status, canManage }: { status: StorageStatus; canManage: boolean }) {
  const { t } = useTranslation();
  const save = useStorageSave();
  const tracker = useSaveState();
  const [draft, setDraft] = useState<Record<(typeof LEVEL_FIELDS)[number], string>>({
    warning: String(status.thresholds.warning),
    largeWrites: String(status.thresholds.largeWrites),
    critical: String(status.thresholds.critical),
  });
  const [errors, setErrors] = useState<Partial<Record<(typeof LEVEL_FIELDS)[number], string>>>({});
  const [saved, setSaved] = useState(status.thresholds);
  if (
    saved.warning !== status.thresholds.warning ||
    saved.largeWrites !== status.thresholds.largeWrites ||
    saved.critical !== status.thresholds.critical
  ) {
    setSaved(status.thresholds);
    setDraft({
      warning: String(status.thresholds.warning),
      largeWrites: String(status.thresholds.largeWrites),
      critical: String(status.thresholds.critical),
    });
  }
  const changed = LEVEL_FIELDS.some((field) => draft[field].trim() !== String(saved[field]));

  const submit = async () => {
    const values = {
      warning: parsePercent(draft.warning),
      largeWrites: parsePercent(draft.largeWrites),
      critical: parsePercent(draft.critical),
    };
    const next: typeof errors = {};
    for (const field of LEVEL_FIELDS) if (values[field] === null) next[field] = t("storage.levels.invalid");
    if (Object.keys(next).length === 0) {
      if ((values.warning ?? 0) >= (values.largeWrites ?? 0)) next.largeWrites = t("storage.levels.order");
      else if ((values.largeWrites ?? 0) >= (values.critical ?? 0)) next.critical = t("storage.levels.order");
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    const ok = await tracker.run(async () => {
      try {
        await save({
          thresholds: {
            warning: values.warning ?? 0,
            largeWrites: values.largeWrites ?? 0,
            critical: values.critical ?? 0,
          },
        });
      } catch (failure) {
        throw new Error(storageProblem(t, failure));
      }
    });
    if (!ok) focusFirstInvalidSoon();
  };
  const cancel = () => {
    setDraft({
      warning: String(saved.warning),
      largeWrites: String(saved.largeWrites),
      critical: String(saved.critical),
    });
    setErrors({});
  };
  const serverError = tracker.state === "error" ? tracker.error : null;
  return (
    <Section title={t("storage.levels.title")}>
      <p className="px-4 pt-3 text-sm text-text-muted">{t("storage.levels.description")}</p>
      <div className="flex flex-col gap-4 p-4">
        {LEVEL_FIELDS.map((field) => (
          <Field
            key={field}
            label={translateKey(t, `storage.levels.${field}`)}
            hint={translateKey(t, `storage.levels.${field}Hint`)}
            {...(errors[field] ? { error: errors[field] } : {})}
          >
            <div className="flex items-center gap-2">
              <Input
                className="w-24"
                inputMode="numeric"
                value={draft[field]}
                disabled={!canManage}
                onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                  if (event.key === "Escape") cancel();
                }}
              />
              <span aria-hidden="true">{t("storage.levels.unit")}</span>
            </div>
          </Field>
        ))}
        {serverError ? (
          <p role="alert" className="text-danger text-sm">
            {serverError}
          </p>
        ) : null}
        {canManage && (changed || tracker.state === "saved") ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {tracker.state === "saved" && !changed ? <SaveIndicator tracker={tracker} /> : null}
            {changed ? (
              <>
                <Button size="sm" onClick={cancel}>
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={tracker.state === "saving"}
                  onClick={() => void submit()}
                >
                  {t("common.save")}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function S3LimitSection({ status, canManage }: { status: StorageStatus; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const save = useStorageSave();
  const tracker = useSaveState();
  const current =
    status.s3LimitBytes === null ? "" : String(Math.round((status.s3LimitBytes / BYTES_PER_GB) * 100) / 100);
  const [draft, setDraft] = useState(current);
  const [saved, setSaved] = useState(current);
  const [error, setError] = useState<string | null>(null);
  if (saved !== current && draft === saved) {
    setDraft(current);
    setSaved(current);
  }
  const commit = async () => {
    const next = draft.trim().replace(",", ".");
    if (next === saved) {
      setError(null);
      return;
    }
    let bytes: number | null = null;
    if (next !== "") {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0 || !/^\d+(\.\d+)?$/.test(next)) {
        setError(t("storage.s3.invalid"));
        return;
      }
      bytes = Math.max(1, Math.round(parsed * BYTES_PER_GB));
    }
    setError(null);
    const ok = await tracker.run(async () => {
      try {
        await save({ s3LimitBytes: bytes });
      } catch (failure) {
        throw new Error(storageProblem(t, failure));
      }
    });
    if (ok) setSaved(next);
  };
  const shownError = error ?? (tracker.state === "error" && tracker.error ? tracker.error : undefined);
  return (
    <Section title={t("storage.s3.title")}>
      <div className="flex flex-col gap-1 p-4">
        <Field
          label={t("storage.s3.label")}
          hint={t("storage.s3.hint")}
          {...(shownError ? { error: shownError } : {})}
        >
          <div className="flex items-center gap-2">
            <Input
              className="w-32"
              inputMode="decimal"
              value={draft}
              disabled={!canManage}
              placeholder={status.usedBytes !== null ? format.bytes(status.usedBytes) : undefined}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commit();
                }
              }}
            />
            <span aria-hidden="true">{t("storage.s3.unit")}</span>
          </div>
        </Field>
        {tracker.state === "error" ? null : <SaveIndicator tracker={tracker} />}
      </div>
    </Section>
  );
}

type WebhookMode = "keep" | "replace" | "remove";

function parseAddresses(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
}

const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ContactsSection({ status, canManage }: { status: StorageStatus; canManage: boolean }) {
  const { t } = useTranslation();
  const save = useStorageSave();
  const tracker = useSaveState();
  const testing = useSaveState();
  const initial = status.operationsEmails.join("\n");
  const [addresses, setAddresses] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [mode, setMode] = useState<WebhookMode>("keep");
  const [webhook, setWebhook] = useState("");
  const [errors, setErrors] = useState<{ addresses?: string; webhook?: string }>({});
  const [result, setResult] = useState<{ variant: "success" | "warning" | "info"; text: string } | null>(
    null,
  );
  if (saved !== initial && addresses === saved) {
    setAddresses(initial);
    setSaved(initial);
  }
  const changed = addresses.trim() !== saved.trim() || mode !== "keep";

  const submit = async () => {
    const list = parseAddresses(addresses);
    const next: typeof errors = {};
    if (list.length > 20 || !list.every((address) => ADDRESS.test(address))) {
      next.addresses = t("storage.contacts.addressesInvalid");
    }
    if (mode === "replace" && webhook.trim() === "") next.webhook = t("validation.required");
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    const ok = await tracker.run(async () => {
      try {
        await save({
          operationsEmails: list,
          ...(mode === "replace"
            ? { teamsWebhook: webhook.trim() }
            : mode === "remove"
              ? { teamsWebhook: null }
              : {}),
        });
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === "invalidStorageSettings") {
          const field = failure.problem.problem === "invalidTeamsWebhook" ? "webhook" : "addresses";
          setErrors({ [field]: storageProblem(t, failure) });
        }
        throw new Error(storageProblem(t, failure));
      }
    });
    if (ok) {
      setSaved(list.join("\n"));
      setAddresses(list.join("\n"));
      setMode("keep");
      setWebhook("");
    } else {
      focusFirstInvalidSoon();
    }
  };
  const cancel = () => {
    setAddresses(saved);
    setMode("keep");
    setWebhook("");
    setErrors({});
  };
  const sendTest = async () => {
    setResult(null);
    if (status.operationsEmails.length === 0 && !status.teamsWebhook.configured) {
      setResult({ variant: "info", text: t("storage.contacts.testNothing") });
      return;
    }
    await testing.run(async () => {
      const sent = await request(() => api.POST("/api/v1/instance/storage/test"));
      const lines: string[] = [];
      if (sent.addresses > 0) lines.push(t("storage.contacts.testMails", { count: sent.addresses }));
      let variant: "success" | "warning" = "success";
      if (sent.teams?.delivered) lines.push(t("storage.contacts.testTeamsOk"));
      if (sent.teams && !sent.teams.delivered) {
        variant = "warning";
        lines.push(
          t("storage.contacts.testTeamsFailed", {
            reason: sent.teams.reason ?? String(sent.teams.status ?? ""),
          }),
        );
      }
      setResult({ variant, text: lines.join(" ") });
    });
  };
  const serverError =
    tracker.state === "error" && !errors.addresses && !errors.webhook ? tracker.error : null;
  return (
    <Section title={t("storage.contacts.title")}>
      <p className="px-4 pt-3 text-sm text-text-muted">{t("storage.contacts.description")}</p>
      <div className="flex flex-col gap-4 p-4">
        <Field
          label={t("storage.contacts.addresses")}
          hint={t("storage.contacts.addressesHint")}
          {...(errors.addresses ? { error: errors.addresses } : {})}
        >
          <Textarea
            rows={3}
            value={addresses}
            disabled={!canManage}
            onChange={(event) => setAddresses(event.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-2">
          {status.teamsWebhook.configured && mode !== "replace" ? (
            <div className="flex flex-col gap-2">
              <span className="font-medium">{t("storage.contacts.webhook")}</span>
              <p className="text-text-muted text-sm">
                {mode === "remove"
                  ? t("storage.contacts.webhookRemoved")
                  : t("storage.contacts.webhookSet", { host: status.teamsWebhook.host ?? "" })}
              </p>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setMode("replace")}>
                    {t("storage.contacts.webhookReplace")}
                  </Button>
                  {mode === "remove" ? (
                    <Button size="sm" onClick={() => setMode("keep")}>
                      {t("storage.contacts.webhookKeep")}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setMode("remove")}>
                      {t("storage.contacts.webhookRemove")}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <Field
              label={t("storage.contacts.webhook")}
              hint={t("storage.contacts.webhookHint")}
              {...(errors.webhook ? { error: errors.webhook } : {})}
            >
              <PasswordInput
                autoComplete="off"
                value={webhook}
                disabled={!canManage}
                placeholder={t("storage.contacts.webhookPlaceholder")}
                onChange={(event) => {
                  setWebhook(event.target.value);
                  setMode(event.target.value === "" ? "keep" : "replace");
                }}
              />
            </Field>
          )}
          {mode === "replace" && status.teamsWebhook.configured ? (
            <Field
              label={t("storage.contacts.webhook")}
              hint={t("storage.contacts.webhookHint")}
              {...(errors.webhook ? { error: errors.webhook } : {})}
            >
              <PasswordInput
                autoComplete="off"
                value={webhook}
                placeholder={t("storage.contacts.webhookPlaceholder")}
                onChange={(event) => setWebhook(event.target.value)}
              />
              <Button
                size="sm"
                onClick={() => {
                  setMode("keep");
                  setWebhook("");
                }}
              >
                {t("storage.contacts.webhookCancelReplace")}
              </Button>
            </Field>
          ) : null}
        </div>
        {serverError ? (
          <p role="alert" className="text-danger text-sm">
            {serverError}
          </p>
        ) : null}
        {canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" loading={testing.state === "saving"} onClick={() => void sendTest()}>
              {t("storage.contacts.test")}
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              {tracker.state === "saved" && !changed ? <SaveIndicator tracker={tracker} /> : null}
              {changed ? (
                <>
                  <Button size="sm" onClick={cancel}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={tracker.state === "saving"}
                    onClick={() => void submit()}
                  >
                    {t("common.save")}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
        {testing.state === "error" && testing.error ? (
          <p role="alert" className="text-danger text-sm">
            {testing.error}
          </p>
        ) : null}
        {result ? <Notice variant={result.variant}>{result.text}</Notice> : null}
      </div>
    </Section>
  );
}

export function InstanceStorageScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const editor = useInstanceSettingsEditor();
  const status = useQuery({ ...storageQuery, throwOnError: false, refetchInterval: REFRESH_MS });
  const canManage = state.can("instance.settings.manage");
  const data = status.data;
  return (
    <SettingsPage title={t("storage.title")} description={t("storage.description")} icon={HardDrive}>
      {status.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {status.isError ? (
        <LoadError what={t("failures.loadStorage")} error={status.error} onRetry={() => status.refetch()} />
      ) : null}
      {data ? (
        <>
          <UsageSection status={data} />
          <LevelsSection status={data} canManage={canManage} />
          {data.store === "s3" ? <S3LimitSection status={data} canManage={canManage} /> : null}
          <Section title={t("storage.reminder.title")}>
            <SettingsList {...editor} keys={["storage.reminder"]} level="instance" />
          </Section>
          <ContactsSection status={data} canManage={canManage} />
        </>
      ) : null}
    </SettingsPage>
  );
}
