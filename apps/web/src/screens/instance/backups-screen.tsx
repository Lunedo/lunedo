import {
  Badge,
  type BadgeVariant,
  Button,
  Checkbox,
  CollapsibleSection,
  ConfirmDialog,
  CopyButton,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Input,
  Menu,
  Notice,
  PasswordInput,
  RadioGroup,
  Section,
  Select,
  SettingRow,
  Skeleton,
  Switch,
  Table,
  type TableColumn,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import {
  type BackupFiles,
  type BackupOverview,
  backupFilesQuery,
  backupsQuery,
  instanceKeys,
} from "../../api/instance-queries.js";
import { ApiError, request } from "../../api/request.js";
import { SaveIndicator, type SaveTracker, useSaveState } from "../../components/auto-save.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { weekdayLabel } from "../../format/zoned.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

type TFunction = ReturnType<typeof useTranslation>["t"];
type Backup = BackupFiles["backups"][number];
type TestRestore = NonNullable<Backup["testRestore"]>;
type Settings = BackupOverview["settings"];

interface SettingsChange {
  enabled?: boolean;
  dailyTime?: string;
  weeklyDay?: number | null;
  monthlyDay?: number | null;
  retention?: Partial<Settings["retention"]>;
  scope?: "all" | "database";
  beforeUpdate?: boolean;
  missingDays?: number;
  autoTestRestore?: boolean;
}

const BUSY_REFRESH_MS = 3_000;
const AWAIT_START_MS = 15_000;
const IDLE_REFRESH_MS = 60_000;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function backupProblem(t: TFunction, failure: unknown): string {
  if (failure instanceof ApiError && failure.code === "invalidBackupSettings") {
    const kind = failure.problem.problem;
    if (typeof kind === "string") return translateKey(t, `backups.errors.${kind}`);
  }
  return problemMessage(t, failure);
}

function useBackupSettings() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return async (body: SettingsChange) => {
    try {
      const saved = await request(() => api.PATCH("/api/v1/instance/backups/settings", { body }));
      queryClient.setQueryData(instanceKeys.backups, saved);
    } catch (failure) {
      throw new Error(backupProblem(t, failure));
    }
  };
}

function StatusSection({
  data,
  canManage,
  onStarted,
}: {
  data: BackupOverview;
  canManage: boolean;
  onStarted: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const tracker = useSaveState();
  const failedLater =
    data.lastFailure &&
    (!data.lastSuccess || (data.lastFailure.finishedAt ?? "") > (data.lastSuccess.finishedAt ?? ""));
  const backUpNow = async () => {
    await tracker.run(async () => {
      try {
        await request(() => api.POST("/api/v1/instance/backups/runs"));
      } catch (failure) {
        throw new Error(backupProblem(t, failure));
      }
      onStarted();
      await queryClient.invalidateQueries({ queryKey: instanceKeys.backups });
    });
  };
  return (
    <Section title={t("backups.status.title")}>
      {data.alert === "failing" && data.lastFailure ? (
        <div className="pt-3">
          <Notice variant="danger" title={t("backups.status.failingTitle")}>
            {data.lastFailure.error ?? t("backups.status.failingUnknown")}
          </Notice>
        </div>
      ) : null}
      {data.alert === "missing" ? (
        <div className="pt-3">
          <Notice variant="warning" title={t("backups.status.missingTitle")}>
            {t("backups.status.missingBody", { count: data.settings.missingDays })}
          </Notice>
        </div>
      ) : null}
      <SettingRow
        label={t("backups.status.lastSuccess")}
        control={
          <span>
            {data.lastSuccess?.finishedAt
              ? t("backups.status.at", {
                  relative: format.relative(data.lastSuccess.finishedAt),
                  time: format.dateTime(data.lastSuccess.finishedAt),
                })
              : t("backups.status.never")}
          </span>
        }
      />
      {failedLater && data.alert !== "failing" && data.lastFailure?.finishedAt ? (
        <SettingRow
          label={t("backups.status.lastFailure")}
          description={data.lastFailure.error ?? undefined}
          control={<span>{format.dateTime(data.lastFailure.finishedAt)}</span>}
        />
      ) : null}
      <SettingRow
        label={t("backups.status.nextRun")}
        control={
          <span>
            {data.nextRunAt
              ? t("backups.status.nextRunAt", { time: format.dateTime(data.nextRunAt), zone: data.timeZone })
              : t("backups.status.noSchedule")}
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-3 py-3">
        {data.running ? <Badge variant="info">{t("backups.status.running")}</Badge> : null}
        {canManage ? (
          <Button variant="primary" loading={tracker.state === "saving"} onClick={() => void backUpNow()}>
            {t("backups.status.backUpNow")}
          </Button>
        ) : null}
        {tracker.state === "saved" ? (
          <span role="status" className="text-sm text-text-muted">
            {t("backups.status.started")}
          </span>
        ) : null}
        {tracker.state === "error" && tracker.error ? (
          <p role="alert" className="text-danger text-sm">
            {tracker.error}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function KeySection({ data, canManage }: { data: BackupOverview; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const queryClient = useQueryClient();
  const tracker = useSaveState();
  const confirm = async (confirmed: boolean) => {
    await tracker.run(async () => {
      const saved = await request(() =>
        api.PUT("/api/v1/instance/backups/key-confirmation", { body: { confirmed } }),
      );
      queryClient.setQueryData(instanceKeys.backups, saved);
    });
  };
  const confirmed = data.keyConfirmed;
  return (
    <Section title={t("backups.key.title")}>
      <div className="flex flex-col gap-3 p-4">
        <Notice variant="warning" title={t("backups.key.warningTitle")}>
          {t("backups.key.warning")}
        </Notice>
        <Checkbox
          checked={confirmed !== null}
          disabled={!canManage}
          onCheckedChange={(checked) => void confirm(checked)}
          label={t("backups.key.confirm")}
          description={
            confirmed
              ? confirmed.by
                ? t("backups.key.confirmedBy", { date: format.date(confirmed.at), name: confirmed.by.name })
                : t("backups.key.confirmedAt", { date: format.date(confirmed.at) })
              : t("backups.key.notConfirmed")
          }
        />
        <SaveIndicator tracker={tracker} />
      </div>
    </Section>
  );
}

interface TargetDraft {
  kind: "local" | "s3";
  path: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
}

type TargetField = "path" | "endpoint" | "region" | "bucket" | "prefix" | "accessKeyId" | "secretAccessKey";

function draftOf(target: BackupOverview["target"]): TargetDraft {
  const empty: TargetDraft = {
    kind: "local",
    path: "/var/lib/lunedo/backups",
    endpoint: "",
    region: "",
    bucket: "",
    prefix: "",
    forcePathStyle: false,
    accessKeyId: "",
    secretAccessKey: "",
  };
  if (!target) return empty;
  if (target.kind === "local") return { ...empty, path: target.path };
  return {
    ...empty,
    kind: "s3",
    path: "",
    endpoint: target.endpoint ?? "",
    region: target.region,
    bucket: target.bucket,
    prefix: target.prefix,
    forcePathStyle: target.forcePathStyle,
    accessKeyId: target.accessKeyId,
  };
}

function bodyOf(draft: TargetDraft) {
  if (draft.kind === "local") return { kind: "local" as const, path: draft.path.trim() };
  return {
    kind: "s3" as const,
    endpoint: draft.endpoint.trim() === "" ? null : draft.endpoint.trim(),
    region: draft.region.trim(),
    bucket: draft.bucket.trim(),
    prefix: draft.prefix.trim(),
    forcePathStyle: draft.forcePathStyle,
    accessKeyId: draft.accessKeyId.trim(),
    ...(draft.secretAccessKey.trim() ? { secretAccessKey: draft.secretAccessKey.trim() } : {}),
  };
}

function TargetSection({ data, canManage }: { data: BackupOverview; canManage: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const tracker = useSaveState();
  const testing = useSaveState();
  const initial = draftOf(data.target);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<TargetField, string>>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (JSON.stringify(saved) !== JSON.stringify(initial) && JSON.stringify(draft) === JSON.stringify(saved)) {
    setSaved(initial);
    setDraft(initial);
  }
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const secretConfigured =
    data.target?.kind === "s3" &&
    data.target.secretKeyConfigured &&
    (["endpoint", "region", "bucket", "accessKeyId"] as const).every(
      (field) => draft[field].trim() === saved[field].trim(),
    );
  const set = (patch: Partial<TargetDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setResult(null);
  };

  const check = (): boolean => {
    const next: typeof errors = {};
    const required = t("validation.required");
    if (draft.kind === "local") {
      if (!/^(\/|[A-Za-z]:[\\/])/.test(draft.path.trim())) next.path = t("backups.errors.invalidPath");
    } else {
      if (draft.endpoint.trim() && !/^https?:\/\//.test(draft.endpoint.trim())) {
        next.endpoint = t("backups.errors.invalidEndpoint");
      }
      if (!draft.region.trim()) next.region = required;
      if (!draft.bucket.trim()) next.bucket = required;
      if (draft.prefix.trim() && !draft.prefix.trim().endsWith("/"))
        next.prefix = t("backups.errors.invalidPrefix");
      if (!draft.accessKeyId.trim()) next.accessKeyId = required;
      if (!secretConfigured && !draft.secretAccessKey.trim())
        next.secretAccessKey = t("backups.errors.secretKeyRequired");
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalidSoon();
      return false;
    }
    return true;
  };

  const fieldError = (failure: unknown) => {
    if (failure instanceof ApiError && failure.code === "invalidBackupSettings") {
      const field = String(failure.problem.fields?.[0] ?? "").replace(/^body\./, "") as TargetField;
      if (field) setErrors({ [field]: backupProblem(t, failure) });
    }
  };

  const submit = async () => {
    if (!check()) return;
    const ok = await tracker.run(async () => {
      try {
        const next = await request(() => api.PUT("/api/v1/instance/backups/target", { body: bodyOf(draft) }));
        queryClient.setQueryData(instanceKeys.backups, next);
        await queryClient.invalidateQueries({ queryKey: instanceKeys.backupFiles });
      } catch (failure) {
        fieldError(failure);
        throw new Error(backupProblem(t, failure));
      }
    });
    if (ok) {
      const next = { ...draft, secretAccessKey: "" };
      setSaved(next);
      setDraft(next);
    } else {
      focusFirstInvalidSoon();
    }
  };

  const test = async () => {
    setResult(null);
    if (!check()) return;
    await testing.run(async () => {
      try {
        const outcome = await request(() =>
          api.POST("/api/v1/instance/backups/target/test", { body: bodyOf(draft) }),
        );
        setResult(
          outcome.ok
            ? { ok: true, text: t("backups.target.testOk") }
            : {
                ok: false,
                text: outcome.failure
                  ? translateKey(
                      t,
                      outcome.blockedAddress
                        ? "backups.target.failures.blockedAddressAt"
                        : `backups.target.failures.${outcome.failure}`,
                      {
                        step: translateKey(t, `backups.target.steps.${outcome.step ?? "write"}`),
                        address: outcome.blockedAddress,
                        network: outcome.allowedNetwork,
                      },
                    )
                  : (outcome.message ?? ""),
              },
        );
      } catch (failure) {
        fieldError(failure);
        throw new Error(backupProblem(t, failure));
      }
    });
  };

  const cancel = () => {
    setDraft(saved);
    setErrors({});
    setResult(null);
  };

  const field = (name: TargetField, label: string, hint: string, control: React.ReactNode) => (
    <Field label={label} hint={hint} {...(errors[name] ? { error: errors[name] } : {})}>
      {control}
    </Field>
  );

  const text = (name: Exclude<TargetField, "secretAccessKey">, placeholder?: string) => (
    <Input
      value={draft[name]}
      disabled={!canManage}
      {...(placeholder ? { placeholder } : {})}
      onChange={(event) => set({ [name]: event.target.value })}
    />
  );

  return (
    <Section title={t("backups.target.title")}>
      <div className="flex flex-col gap-4 p-4">
        {data.target === null ? (
          <Notice variant="info" title={t("backups.target.noneTitle")}>
            {t("backups.target.none")}
          </Notice>
        ) : null}
        <RadioGroup
          label={t("backups.target.kind")}
          variant="card"
          value={draft.kind}
          onValueChange={(value) => set({ kind: value === "s3" ? "s3" : "local" })}
          options={[
            {
              value: "local",
              label: t("backups.target.local"),
              description: t("backups.target.localDescription"),
            },
            { value: "s3", label: t("backups.target.s3"), description: t("backups.target.s3Description") },
          ]}
        />
        {draft.kind === "local" ? (
          <>
            {field(
              "path",
              t("backups.target.path"),
              t("backups.target.pathHint"),
              text("path", "/var/lib/lunedo/backups"),
            )}
            {data.target?.kind === "local" && data.target.sameVolumeAsFiles && !changed ? (
              <Notice variant="warning" title={t("backups.target.sameVolumeTitle")}>
                {t("backups.target.sameVolume")}
              </Notice>
            ) : null}
          </>
        ) : (
          <>
            {field(
              "endpoint",
              t("backups.target.endpoint"),
              t("backups.target.endpointHint"),
              text("endpoint", "https://s3.example.org"),
            )}
            {field(
              "region",
              t("backups.target.region"),
              t("backups.target.regionHint"),
              text("region", "eu-central-1"),
            )}
            {field(
              "bucket",
              t("backups.target.bucket"),
              t("backups.target.bucketHint"),
              text("bucket", "lunedo-backups"),
            )}
            {field(
              "prefix",
              t("backups.target.prefix"),
              t("backups.target.prefixHint"),
              text("prefix", "lunedo/"),
            )}
            {field(
              "accessKeyId",
              t("backups.target.accessKey"),
              t("backups.target.accessKeyHint"),
              text("accessKeyId"),
            )}
            {field(
              "secretAccessKey",
              t("backups.target.secretKey"),
              secretConfigured ? t("backups.target.secretKeyStored") : t("backups.target.secretKeyHint"),
              <PasswordInput
                autoComplete="off"
                value={draft.secretAccessKey}
                disabled={!canManage}
                onChange={(event) => set({ secretAccessKey: event.target.value })}
              />,
            )}
            <Checkbox
              checked={draft.forcePathStyle}
              disabled={!canManage}
              onCheckedChange={(checked) => set({ forcePathStyle: checked })}
              label={t("backups.target.pathStyle")}
              description={t("backups.target.pathStyleHint")}
            />
          </>
        )}
        {result ? <Notice variant={result.ok ? "success" : "danger"}>{result.text}</Notice> : null}
        {testing.state === "error" && testing.error ? (
          <p role="alert" className="text-danger text-sm">
            {testing.error}
          </p>
        ) : null}
        {tracker.state === "error" && tracker.error && Object.keys(errors).length === 0 ? (
          <p role="alert" className="text-danger text-sm">
            {tracker.error}
          </p>
        ) : null}
        {canManage ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" loading={testing.state === "saving"} onClick={() => void test()}>
              {t("backups.target.test")}
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
                    {t("backups.target.save")}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}

function useImmediate(
  save: ReturnType<typeof useBackupSettings>,
): [SaveTracker, (change: SettingsChange) => Promise<boolean>] {
  const tracker = useSaveState();
  return [tracker, (change) => tracker.run(() => save(change))];
}

function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onSave,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onSave: (value: number) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const tracker = useSaveState();
  const [draft, setDraft] = useState(String(value));
  const [saved, setSaved] = useState(value);
  const [error, setError] = useState<string | null>(null);
  if (saved !== value) {
    setSaved(value);
    setDraft(String(value));
  }
  const commit = async () => {
    const cleaned = draft.trim();
    if (cleaned === String(saved)) return;
    const parsed = Number(cleaned);
    if (!/^\d+$/.test(cleaned) || parsed < min || parsed > max) {
      setError(t("backups.errors.range", { min, max }));
      return;
    }
    setError(null);
    await tracker.run(() => onSave(parsed));
  };
  const shown = error ?? (tracker.state === "error" ? tracker.error : null);
  return (
    <Field label={label} hint={hint} {...(shown ? { error: shown } : {})}>
      <div className="flex items-center gap-2">
        <Input
          className="w-24"
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
          }}
        />
        {tracker.state === "error" ? null : <SaveIndicator tracker={tracker} />}
      </div>
    </Field>
  );
}

function ScheduleSection({ data, canManage }: { data: BackupOverview; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const save = useBackupSettings();
  const [enabledTracker, saveEnabled] = useImmediate(save);
  const [timeTracker, saveTime] = useImmediate(save);
  const [weeklyTracker, saveWeekly] = useImmediate(save);
  const [monthlyTracker, saveMonthly] = useImmediate(save);
  const settings = data.settings;
  const [time, setTime] = useState(settings.dailyTime);
  const [savedTime, setSavedTime] = useState(settings.dailyTime);
  const [timeError, setTimeError] = useState<string | null>(null);
  if (savedTime !== settings.dailyTime) {
    setSavedTime(settings.dailyTime);
    setTime(settings.dailyTime);
  }
  const commitTime = async () => {
    const cleaned = time.trim();
    if (cleaned === savedTime) return;
    if (!TIME.test(cleaned)) {
      setTimeError(t("backups.errors.invalidTime"));
      return;
    }
    setTimeError(null);
    await saveTime({ dailyTime: cleaned });
  };
  const dayName = (day: number) => weekdayLabel(day - 1, i18n.language, "long");
  return (
    <Section title={t("backups.schedule.title")}>
      <SettingRow
        label={t("backups.schedule.enabled")}
        description={t("backups.schedule.enabledHint")}
        status={<SaveIndicator tracker={enabledTracker} />}
        control={
          <Switch
            label={t("backups.schedule.enabled")}
            labelHidden
            checked={settings.enabled}
            disabled={!canManage}
            onCheckedChange={(checked) => void saveEnabled({ enabled: checked })}
          />
        }
      />
      <div className="flex flex-col gap-4 p-4">
        <Field
          label={t("backups.schedule.time")}
          hint={t("backups.schedule.timeHint", { zone: data.timeZone })}
          {...(timeError
            ? { error: timeError }
            : timeTracker.state === "error" && timeTracker.error
              ? { error: timeTracker.error }
              : {})}
        >
          <div className="flex items-center gap-2">
            <Input
              className="w-28"
              inputMode="numeric"
              placeholder="02:00"
              value={time}
              disabled={!canManage}
              onChange={(event) => setTime(event.target.value)}
              onBlur={() => void commitTime()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitTime();
                }
              }}
            />
            {timeTracker.state === "error" ? null : <SaveIndicator tracker={timeTracker} />}
          </div>
        </Field>
        <Field label={t("backups.schedule.weekly")} hint={t("backups.schedule.weeklyHint")}>
          <div className="flex items-center gap-2">
            <Select
              value={settings.weeklyDay === null ? "none" : String(settings.weeklyDay)}
              disabled={!canManage}
              onValueChange={(value) =>
                void saveWeekly({ weeklyDay: value === "none" ? null : Number(value) })
              }
              options={[
                { value: "none", label: t("backups.schedule.noWeekly") },
                ...WEEKDAYS.map((day) => ({ value: String(day), label: dayName(day) })),
              ]}
            />
            <SaveIndicator tracker={weeklyTracker} />
          </div>
        </Field>
        <Field label={t("backups.schedule.monthly")} hint={t("backups.schedule.monthlyHint")}>
          <div className="flex items-center gap-2">
            <Select
              value={settings.monthlyDay === null ? "none" : String(settings.monthlyDay)}
              disabled={!canManage}
              onValueChange={(value) =>
                void saveMonthly({ monthlyDay: value === "none" ? null : Number(value) })
              }
              options={[
                { value: "none", label: t("backups.schedule.noMonthly") },
                ...Array.from({ length: 31 }, (_, index) => ({
                  value: String(index + 1),
                  label: t("backups.schedule.dayOfMonth", { day: index + 1 }),
                })),
              ]}
            />
            <SaveIndicator tracker={monthlyTracker} />
          </div>
        </Field>
      </div>
    </Section>
  );
}

function RetentionSection({ data, canManage }: { data: BackupOverview; canManage: boolean }) {
  const { t } = useTranslation();
  const save = useBackupSettings();
  const retention = data.settings.retention;
  const counts = ["daily", "weekly", "monthly"] as const;
  return (
    <Section title={t("backups.retention.title")}>
      <p className="pt-3 text-sm text-text-muted">{t("backups.retention.description")}</p>
      <div className="grid gap-4 p-4 sm:grid-cols-3">
        {counts.map((kind) => (
          <NumberSetting
            key={kind}
            label={translateKey(t, `backups.retention.${kind}`)}
            hint={translateKey(t, `backups.retention.${kind}Hint`)}
            value={retention[kind]}
            min={1}
            max={1000}
            disabled={!canManage}
            onSave={(value) => save({ retention: { [kind]: value } })}
          />
        ))}
      </div>
    </Section>
  );
}

function UpdatesSection({ data, canManage }: { data: BackupOverview; canManage: boolean }) {
  const { t } = useTranslation();
  const save = useBackupSettings();
  const [tracker, saveBefore] = useImmediate(save);
  const environment = data.beforeUpdate.disabledBy === "environment";
  return (
    <Section title={t("backups.updates.title")}>
      {environment ? (
        <div className="pt-3">
          <Notice variant="info" title={t("backups.updates.environmentTitle")}>
            {t("backups.updates.environment")}
          </Notice>
        </div>
      ) : null}
      <SettingRow
        label={t("backups.updates.enabled")}
        description={data.target ? t("backups.updates.enabledHint") : t("backups.updates.defaultTarget")}
        status={<SaveIndicator tracker={tracker} />}
        control={
          <Switch
            label={t("backups.updates.enabled")}
            labelHidden
            checked={data.settings.beforeUpdate}
            disabled={!canManage}
            onCheckedChange={(checked) => void saveBefore({ beforeUpdate: checked })}
          />
        }
      />
      <div className="p-4">
        <NumberSetting
          label={t("backups.retention.beforeUpdate")}
          hint={t("backups.retention.beforeUpdateHint")}
          value={data.settings.retention.beforeUpdate}
          min={1}
          max={1000}
          disabled={!canManage}
          onSave={(value) => save({ retention: { beforeUpdate: value } })}
        />
      </div>
    </Section>
  );
}

function AdvancedSection({ data, canManage }: { data: BackupOverview; canManage: boolean }) {
  const { t } = useTranslation();
  const save = useBackupSettings();
  const [scopeTracker, saveScope] = useImmediate(save);
  const [testTracker, saveTest] = useImmediate(save);
  return (
    <CollapsibleSection title={t("backups.advanced.title")} layout="fields">
      <RadioGroup
        label={t("backups.advanced.scope")}
        value={data.settings.scope}
        onValueChange={(value) => void saveScope({ scope: value === "database" ? "database" : "all" })}
        options={[
          {
            value: "all",
            label: t("backups.advanced.scopeAll"),
            description: t("backups.advanced.scopeAllHint"),
          },
          {
            value: "database",
            label: t("backups.advanced.scopeDatabase"),
            description: t("backups.advanced.scopeDatabaseHint"),
            disabled: !canManage,
          },
        ]}
      />
      <SaveIndicator tracker={scopeTracker} />
      <NumberSetting
        label={t("backups.advanced.missingDays")}
        hint={t("backups.advanced.missingDaysHint")}
        value={data.settings.missingDays}
        min={1}
        max={365}
        disabled={!canManage}
        onSave={(value) => save({ missingDays: value })}
      />
      <SettingRow
        label={t("backups.advanced.autoTestRestore")}
        description={t("backups.advanced.autoTestRestoreHint")}
        status={<SaveIndicator tracker={testTracker} />}
        control={
          <Switch
            label={t("backups.advanced.autoTestRestore")}
            labelHidden
            checked={data.settings.autoTestRestore}
            disabled={!canManage}
            onCheckedChange={(checked) => void saveTest({ autoTestRestore: checked })}
          />
        }
      />
      <p className="text-sm text-text-muted">{t("backups.advanced.contacts")}</p>
    </CollapsibleSection>
  );
}

const TEST_BADGES: Record<TestRestore["state"], BadgeVariant> = {
  running: "info",
  passed: "success",
  verified: "warning",
  failed: "danger",
};

function TestRestoreDetails({ test, onClose }: { test: TestRestore | null; onClose: () => void }) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <Dialog
      open={test !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title={t("backups.test.title")}
      size="lg"
    >
      {test ? (
        <div className="flex flex-col gap-4">
          <Badge variant={TEST_BADGES[test.state]}>
            {translateKey(t, `backups.test.states.${test.state}`)}
          </Badge>
          <p className="text-sm text-text-muted">
            {test.actor
              ? t("backups.test.startedBy", { time: format.dateTime(test.startedAt), name: test.actor.name })
              : t("backups.test.startedAutomatically", { time: format.dateTime(test.startedAt) })}
          </p>
          {test.error ? (
            <Notice variant={test.state === "verified" ? "warning" : "danger"}>{test.error}</Notice>
          ) : null}
          <ul className="flex flex-col gap-3">
            {test.checks.map((check) => (
              <li key={check.check} className="flex flex-col gap-1">
                <span className="font-medium">
                  {check.passed ? "✓ " : "✗ "}
                  {translateKey(t, `backups.test.checks.${check.check}`)}
                </span>
                {check.check === "rows" ? (
                  <span className="text-sm text-text-muted">
                    {Object.entries(check.detail)
                      .map(([table, count]) => `${table}: ${count}`)
                      .join(", ")}
                  </span>
                ) : null}
                {check.check === "files" && check.detail.included === false ? (
                  <span className="text-sm text-text-muted">{t("backups.test.filesNotIncluded")}</span>
                ) : null}
                {check.check === "files" &&
                typeof check.detail.missing === "number" &&
                check.detail.missing > 0 ? (
                  <span className="text-sm text-text-muted">
                    {t("backups.test.filesMissing", { count: check.detail.missing })}
                  </span>
                ) : null}
                {check.check === "privilege" && typeof check.detail.grant === "string" ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm text-text-muted">{t("backups.test.privilege")}</span>
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-surface-sunken px-2 py-1 text-sm">
                        {check.detail.grant}
                      </code>
                      <CopyButton value={check.detail.grant} label={t("backups.test.copyGrant")} />
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

function BackupsTable({
  rows,
  caption,
  canManage,
  onTest,
  onDelete,
  onDetails,
}: {
  rows: Backup[];
  caption: string;
  canManage: boolean;
  onTest: (backup: Backup) => void;
  onDelete: (backup: Backup) => void;
  onDetails: (backup: Backup) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const columns: TableColumn<Backup>[] = [
    { key: "createdAt", header: t("backups.list.created"), cell: (row) => format.dateTime(row.createdAt) },
    {
      key: "class",
      header: t("backups.list.class"),
      cell: (row) => <Badge variant="neutral">{translateKey(t, `backups.classes.${row.backupClass}`)}</Badge>,
      hideBelow: "sm",
    },
    {
      key: "size",
      header: t("backups.list.size"),
      align: "end",
      cell: (row) => <span className="tabular-nums">{format.bytes(row.sizeBytes)}</span>,
    },
    {
      key: "version",
      header: t("backups.list.version"),
      hideBelow: "md",
      cell: (row) => row.lunedoVersion ?? t("backups.list.unreadable"),
    },
    {
      key: "test",
      header: t("backups.list.testRestore"),
      cell: (row) =>
        row.testRestore ? (
          <Badge variant={TEST_BADGES[row.testRestore.state]}>
            {translateKey(t, `backups.test.states.${row.testRestore.state}`)}
          </Badge>
        ) : (
          <span className="text-text-muted">{t("backups.list.notTested")}</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">{t("backups.list.actions")}</span>,
      align: "end",
      cell: (row) =>
        canManage && row.readable ? (
          <Menu
            trigger={
              <IconButton icon={MoreHorizontal} label={t("backups.list.actionsFor", { name: row.name })} />
            }
            items={[
              { label: t("backups.list.runTestRestore"), onSelect: () => onTest(row) },
              ...(row.testRestore
                ? [{ label: t("backups.list.showTestRestore"), onSelect: () => onDetails(row) }]
                : []),
              { type: "separator" as const },
              { label: t("backups.list.delete"), danger: true, onSelect: () => onDelete(row) },
            ]}
          />
        ) : null,
    },
  ];
  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(row) => row.name}
      caption={caption}
      rowLabel={(row) => row.name}
      onRowClick={(row) => (row.testRestore ? onDetails(row) : undefined)}
    />
  );
}

function ListSection({
  data,
  canManage,
  busy,
  onStarted,
}: {
  data: BackupOverview;
  canManage: boolean;
  busy: boolean;
  onStarted: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const files = useQuery({
    ...backupFilesQuery,
    throwOnError: false,
    refetchInterval: busy ? BUSY_REFRESH_MS : IDLE_REFRESH_MS,
  });
  const [deleting, setDeleting] = useState<Backup | null>(null);
  const [details, setDetails] = useState<TestRestore | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: instanceKeys.backupFiles });
    await queryClient.invalidateQueries({ queryKey: instanceKeys.backups });
  };
  const testRestore = async (backup: Backup) => {
    try {
      await request(() =>
        api.POST("/api/v1/instance/backups/files/{name}/test-restore", {
          params: { path: { name: backup.name } },
        }),
      );
      onStarted();
      await refresh();
    } catch (failure) {
      showFailure(t("backups.failures.testRestore"), failure, () => void testRestore(backup));
    }
  };
  if (!data.target) return null;
  const list = files.data;
  const groups: [string, Backup[]][] = list
    ? [
        [
          t("backups.list.scheduled"),
          list.backups.filter((backup) => ["daily", "weekly", "monthly"].includes(backup.backupClass)),
        ],
        [t("backups.list.manual"), list.backups.filter((backup) => backup.backupClass === "manual")],
        [
          t("backups.list.beforeUpdate"),
          list.backups.filter((backup) => backup.backupClass === "beforeUpdate"),
        ],
      ]
    : [];
  return (
    <Section title={t("backups.list.title")}>
      <div className="flex flex-col gap-4 p-4">
        {files.isPending ? <Skeleton className="h-24 w-full" /> : null}
        {files.isError ? (
          <LoadError what={t("backups.failures.list")} error={files.error} onRetry={() => files.refetch()} />
        ) : null}
        {list && !list.available && list.error ? (
          <Notice variant="danger" title={t("backups.list.unavailableTitle")}>
            {list.error}
          </Notice>
        ) : null}
        {list?.available && list.backups.length === 0 ? (
          <EmptyState
            icon={DatabaseBackup}
            title={t("backups.list.emptyTitle")}
            description={t("backups.list.empty")}
          />
        ) : null}
        {groups
          .filter(([, rows]) => rows.length > 0)
          .map(([caption, rows]) => (
            <div key={caption} className="flex flex-col gap-2">
              <h3 className="font-medium">{caption}</h3>
              <BackupsTable
                rows={rows}
                caption={caption}
                canManage={canManage}
                onTest={(backup) => void testRestore(backup)}
                onDelete={setDeleting}
                onDetails={(backup) => setDetails(backup.testRestore)}
              />
            </div>
          ))}
      </div>
      <TestRestoreDetails test={details} onClose={() => setDetails(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? null : setDeleting(null))}
        title={t("backups.delete.title")}
        description={t("backups.delete.description")}
        confirmLabel={t("backups.delete.confirm")}
        cancelLabel={t("backups.delete.keep")}
        destructive
        typedConfirmation={{
          value: deleting?.name ?? "",
          label: t("common.typeToConfirm", { name: deleting?.name ?? "" }),
          mismatch: t("common.nameMismatch"),
        }}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/instance/backups/files/{name}", {
                params: { path: { name: deleting.name } },
              }),
            );
            setDeleting(null);
            await refresh();
          } catch (failure) {
            showFailure(t("backups.failures.delete"), failure);
            throw failure;
          }
        }}
      />
    </Section>
  );
}

export function InstanceBackupsScreen() {
  const { t } = useTranslation();
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const overview = useQuery({
    ...backupsQuery,
    throwOnError: false,
    refetchInterval: (query) =>
      awaitingSince !== null || query.state.data?.running || query.state.data?.testRestoreRunning
        ? BUSY_REFRESH_MS
        : IDLE_REFRESH_MS,
  });
  const canManage = useOrganizationState().can("instance.operations.manage");
  const data = overview.data;
  const serverBusy = Boolean(data?.running || data?.testRestoreRunning);
  if (awaitingSince !== null && !serverBusy && Date.now() - awaitingSince > AWAIT_START_MS) {
    setAwaitingSince(null);
  }
  const busy = serverBusy || awaitingSince !== null;
  const started = () => setAwaitingSince(Date.now());
  return (
    <SettingsPage title={t("backups.title")} description={t("backups.description")}>
      {overview.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {overview.isError ? (
        <LoadError
          what={t("backups.failures.load")}
          error={overview.error}
          onRetry={() => overview.refetch()}
        />
      ) : null}
      {data ? (
        <>
          {canManage ? null : <p className="text-sm text-text-muted">{t("backups.readOnly")}</p>}
          <StatusSection data={data} canManage={canManage} onStarted={started} />
          <KeySection data={data} canManage={canManage} />
          <TargetSection data={data} canManage={canManage} />
          <ScheduleSection data={data} canManage={canManage} />
          <RetentionSection data={data} canManage={canManage} />
          <UpdatesSection data={data} canManage={canManage} />
          <AdvancedSection data={data} canManage={canManage} />
          <ListSection data={data} canManage={canManage} busy={busy} onStarted={started} />
        </>
      ) : null}
    </SettingsPage>
  );
}
