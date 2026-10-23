import { Badge, Button, CopyButton, Notice, Section, SettingRow, Skeleton, useToast } from "@lunedo/ui";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { docsUrl } from "../../docs/docs-url.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { useInstanceSettingsEditor } from "./general-screen.js";

export const updatesQuery = queryOptions({
  queryKey: ["instance", "updates"] as const,
  queryFn: () => request(() => api.GET("/api/v1/instance/updates")),
});

type Updates = Awaited<ReturnType<NonNullable<(typeof updatesQuery)["queryFn"]>>>;
type Notes = NonNullable<Updates["whatsNew"]["notes"]>;

const GROUPS = ["breaking", "manualSteps", "new", "improved", "fixed"] as const;

function NotesList({ notes }: { notes: Notes }) {
  const { t } = useTranslation();
  const groups = GROUPS.filter((group) => notes[group].length > 0);
  if (groups.length === 0) return <p className="text-sm text-text-muted">{t("updates.notes.empty")}</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const list = (
          <ul key={`${group}-entries`} className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {notes[group].map((entry) => (
              <li key={entry} className="wrap-anywhere whitespace-pre-line">
                {entry}
              </li>
            ))}
          </ul>
        );
        return group === "breaking" || group === "manualSteps" ? (
          <Notice key={group} variant="warning" title={translateKey(t, `updates.notes.groups.${group}`)}>
            {list}
          </Notice>
        ) : (
          <div key={group} className="flex flex-col gap-1">
            <h3 className="font-medium">{translateKey(t, `updates.notes.groups.${group}`)}</h3>
            {list}
          </div>
        );
      })}
    </div>
  );
}

function CheckSection({ updates, canManage }: { updates: Updates; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editor = useInstanceSettingsEditor();
  const [checking, setChecking] = useState(false);
  const check = updates.check;

  const checkNow = async () => {
    setChecking(true);
    try {
      const result = await request(() => api.POST("/api/v1/instance/updates/check"));
      queryClient.setQueryData(updatesQuery.queryKey, result);
    } catch (error) {
      toast({
        variant: "error",
        title: t("updates.check.failedToStart"),
        description: problemMessage(t, error),
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Section
      title={t("updates.check.title")}
      actions={
        canManage && check.enabled ? (
          <Button
            size="sm"
            variant="secondary"
            icon={RefreshCw}
            loading={checking}
            onClick={() => void checkNow()}
          >
            {t("updates.check.now")}
          </Button>
        ) : null
      }
    >
      {check.disabledBy === "environment" ? (
        <div className="py-3">
          <Notice variant="info" title={t("updates.check.offByEnvironmentTitle")}>
            {t("updates.check.offByEnvironment")}
          </Notice>
        </div>
      ) : (
        <SettingsList {...editor} keys={["operations.updateCheck"]} level="instance" />
      )}
      <p className="py-3 text-sm text-text-muted">{t("updates.check.privacy", { url: check.url })}</p>
      {check.enabled ? (
        <SettingRow
          label={t("updates.check.last")}
          description={
            check.checkedAt
              ? t("updates.check.checkedAt", { time: format.relative(check.checkedAt) })
              : t("updates.check.notYet")
          }
          control={
            check.checkedAt ? (
              <Badge variant={check.succeeded ? "success" : "danger"}>
                {check.succeeded ? t("updates.check.succeeded") : t("updates.check.failed")}
              </Badge>
            ) : null
          }
        />
      ) : null}
      {check.enabled && check.checkedAt && !check.succeeded && check.failure ? (
        <div className="pb-3">
          <Notice variant="danger" title={t("updates.check.failedTitle")}>
            {translateKey(t, `updates.check.failures.${check.failure}`)}
          </Notice>
        </div>
      ) : null}
    </Section>
  );
}

function AvailableSection({ updates }: { updates: Updates }) {
  const { t } = useTranslation();
  if (!updates.check.enabled) return null;
  if (updates.available.length === 0 || !updates.latest) {
    return updates.check.succeeded ? (
      <Notice variant="success" title={t("updates.available.upToDateTitle")}>
        {t("updates.available.upToDate", { version: updates.running })}
      </Notice>
    ) : null;
  }
  return (
    <Section title={t("updates.available.title", { version: updates.latest })} icon={ArrowUpCircle}>
      <div className="flex flex-col gap-4 py-3">
        {updates.runningIsRelease ? null : (
          <Notice variant="info">{t("updates.available.notRelease", { version: updates.running })}</Notice>
        )}
        {updates.commands ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">{t("updates.commands.title")}</h3>
            <p className="text-sm text-text-muted">
              {translateKey(t, `updates.commands.methods.${updates.commands.method}`)}
            </p>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
              {updates.commands.steps.map((step) => (
                <li key={step.text}>
                  {step.kind === "command" ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <code className="break-all rounded-sm bg-surface-sunken px-2 py-1 font-mono">
                        {step.text}
                      </code>
                      <CopyButton value={step.text} label={t("updates.commands.copy")} />
                    </span>
                  ) : (
                    step.text
                  )}
                </li>
              ))}
            </ol>
            <a
              href={docsUrl("setup.md#updates")}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-accent underline focus-visible:focus-ring"
            >
              {t("updates.commands.docs")}
            </a>
          </div>
        ) : null}
        {updates.available
          .slice()
          .reverse()
          .map((release) => (
            <section key={release.version} className="flex flex-col gap-2 border-t border-border pt-3">
              <h3 className="font-semibold">
                {release.date
                  ? t("updates.release.titleDated", { version: release.version, date: release.date })
                  : t("updates.release.title", { version: release.version })}
              </h3>
              {release.minimumUpdateFrom ? (
                <p className="text-sm">
                  {t("updates.release.minimum", { version: release.minimumUpdateFrom })}
                </p>
              ) : null}
              <NotesList notes={release.notes} />
              {release.url ? (
                <a
                  href={release.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-accent underline focus-visible:focus-ring"
                >
                  {t("updates.release.link", { version: release.version })}
                </a>
              ) : null}
            </section>
          ))}
      </div>
    </Section>
  );
}

function WhatsNewSection({ updates }: { updates: Updates }) {
  const { t } = useTranslation();
  const whatsNew = updates.whatsNew;
  return (
    <Section title={t("updates.whatsNew.title", { version: updates.running })}>
      <div className="py-3">
        {whatsNew.notes ? (
          <NotesList notes={whatsNew.notes} />
        ) : (
          <p className="text-sm text-text-muted">
            {whatsNew.available ? t("updates.whatsNew.noSection") : t("updates.whatsNew.unavailable")}
          </p>
        )}
      </div>
    </Section>
  );
}

export function InstanceUpdatesScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const updates = useQuery({ ...updatesQuery, throwOnError: false });
  const data = updates.data;
  return (
    <SettingsPage title={t("updates.title")} description={t("updates.description")}>
      {updates.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {updates.isError ? (
        <LoadError what={t("updates.loadFailed")} error={updates.error} onRetry={() => updates.refetch()} />
      ) : null}
      {data ? (
        <>
          <Section title={t("updates.running.title")}>
            <SettingRow label={t("updates.running.version")} control={<code>{data.running}</code>} />
          </Section>
          <AvailableSection updates={data} />
          <CheckSection updates={data} canManage={state.can("instance.operations.manage")} />
          <WhatsNewSection updates={data} />
        </>
      ) : null}
    </SettingsPage>
  );
}
