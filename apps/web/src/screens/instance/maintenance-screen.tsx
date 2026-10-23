import {
  Badge,
  Button,
  Checkbox,
  Field,
  focusFirstInvalidSoon,
  Notice,
  Section,
  SettingRow,
  Skeleton,
  Textarea,
  useToast,
} from "@lunedo/ui";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { maintenanceChanged } from "../../api/maintenance.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export const MESSAGE_MAX = 500;

const detailsQuery = queryOptions({
  queryKey: ["instance", "maintenance"] as const,
  queryFn: () => request(() => api.GET("/api/v1/instance/maintenance")),
});

type Details = Awaited<ReturnType<NonNullable<(typeof detailsQuery)["queryFn"]>>>;

interface Input {
  enabled: boolean;
  message: string;
  blockSignIn: boolean;
}

export function normalizedMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function MaintenanceForm({ details, canManage }: { details: Details; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState(details.message);
  const [blockSignIn, setBlockSignIn] = useState(details.blockSignIn);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLDivElement>(null);
  const changed = normalizedMessage(message) !== details.message || blockSignIn !== details.blockSignIn;

  const send = async (body: Input): Promise<Details> => {
    const saved = await request(() => api.PUT("/api/v1/instance/maintenance", { body }));
    queryClient.setQueryData(detailsQuery.queryKey, saved);
    maintenanceChanged(queryClient);
    return saved;
  };

  const messageProblem = (value: string): string | null => {
    const length = normalizedMessage(value).length;
    return length > MESSAGE_MAX
      ? t("maintenance.form.messageTooLong", { max: MESSAGE_MAX, count: length })
      : null;
  };

  const submit = async (enabled: boolean) => {
    const text = normalizedMessage(message);
    const problem = enabled ? messageProblem(message) : null;
    if (problem) {
      setError(problem);
      focusFirstInvalidSoon(form.current ?? undefined);
      return;
    }
    setError(null);
    setFailure(null);
    setBusy(true);
    const previous: Input = {
      enabled: details.enabled,
      message: details.message,
      blockSignIn: details.blockSignIn,
    };
    try {
      await send({ enabled, message: text, blockSignIn });
      const title = !enabled
        ? t("maintenance.form.switchedOff")
        : previous.enabled
          ? t("maintenance.form.updated")
          : t("maintenance.form.switchedOn");
      toast({
        variant: "success",
        title,
        undo: {
          onUndo: () => {
            void send(previous).catch((undoError: unknown) =>
              toast({
                variant: "error",
                title: t("maintenance.form.undoFailed"),
                description: problemMessage(t, undoError),
              }),
            );
          },
        },
      });
    } catch (caught) {
      setFailure(problemMessage(t, caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section title={t("maintenance.state.title")}>
        <SettingRow
          label={t("maintenance.state.label")}
          description={
            details.enabled && details.startedAt
              ? details.changedBy
                ? t("maintenance.state.sinceBy", {
                    time: format.relative(details.startedAt),
                    name: details.changedBy.name,
                  })
                : t("maintenance.state.since", { time: format.relative(details.startedAt) })
              : t("maintenance.state.offDescription")
          }
          control={
            <Badge variant={details.enabled ? "warning" : "neutral"}>
              {details.enabled ? t("maintenance.state.on") : t("maintenance.state.off")}
            </Badge>
          }
        />
        {details.enabled && details.blockSignIn ? (
          <div className="pb-3">
            <Notice variant="warning">{t("maintenance.state.signInPaused")}</Notice>
          </div>
        ) : null}
      </Section>
      <Section title={t("maintenance.effects.title")}>
        <ul className="flex list-disc flex-col gap-1 py-3 pr-4 pl-9 text-sm">
          <li>{t("maintenance.effects.readOnly")}</li>
          <li>{t("maintenance.effects.editors")}</li>
          <li>{t("maintenance.effects.jobs")}</li>
          <li>{t("maintenance.effects.running")}</li>
          <li>{t("maintenance.effects.sessions")}</li>
        </ul>
      </Section>
      {canManage ? (
        <Section title={details.enabled ? t("maintenance.form.changeTitle") : t("maintenance.form.title")}>
          <div ref={form} className="flex flex-col gap-4 py-3">
            <Field
              label={t("maintenance.form.message")}
              hint={t("maintenance.form.messageHint", { max: MESSAGE_MAX })}
              {...(error ? { error } : {})}
            >
              <Textarea
                value={message}
                invalid={Boolean(error)}
                rows={3}
                onChange={(event) => {
                  setMessage(event.target.value);
                  if (error) setError(messageProblem(event.target.value));
                  setFailure(null);
                }}
                onBlur={() => setError(messageProblem(message))}
              />
            </Field>
            <Checkbox
              checked={blockSignIn}
              onCheckedChange={(checked) => setBlockSignIn(checked === true)}
              label={t("maintenance.form.blockSignIn")}
              description={t("maintenance.form.blockSignInHint")}
            />
            {failure ? (
              <p role="alert" className="text-sm text-danger">
                {failure}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {details.enabled ? (
                <>
                  {changed ? (
                    <Button variant="primary" loading={busy} onClick={() => void submit(true)}>
                      {t("maintenance.form.save")}
                    </Button>
                  ) : null}
                  <Button
                    variant={changed ? "secondary" : "primary"}
                    loading={busy}
                    onClick={() => void submit(false)}
                  >
                    {t("maintenance.form.switchOff")}
                  </Button>
                </>
              ) : (
                <Button variant="primary" loading={busy} onClick={() => void submit(true)}>
                  {t("maintenance.form.switchOn")}
                </Button>
              )}
            </div>
            <p className="text-sm text-text-muted">{t("maintenance.form.commandLine")}</p>
          </div>
        </Section>
      ) : null}
    </>
  );
}

export function InstanceMaintenanceScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const details = useQuery({ ...detailsQuery, throwOnError: false });
  return (
    <SettingsPage title={t("maintenance.title")} description={t("maintenance.description")}>
      {details.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {details.isError ? (
        <LoadError
          what={t("maintenance.loadFailed")}
          error={details.error}
          onRetry={() => details.refetch()}
        />
      ) : null}
      {details.data ? (
        <MaintenanceForm
          key={`${details.data.changedAt ?? "never"}`}
          details={details.data}
          canManage={state.can("instance.operations.manage")}
        />
      ) : null}
    </SettingsPage>
  );
}
