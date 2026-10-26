import type { SetupStepDetails } from "@lunedo/shared";
import { Button, Icon, Notice } from "@lunedo/ui";
import { Lock, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../api/client.js";
import { request } from "../../../api/request.js";
import { problemMessage } from "../../../errors/problem-message.js";
import { timeZoneName } from "../../../format/time-zones.js";
import { languageLabel } from "../../../settings/locale-options.js";
import { type SetupStepState, stepDetails } from "../setup-api.js";
import { formatsSuggestion } from "./organization-step.js";

type SetupPage = "instance" | "systemCheck" | "owner" | "keyBackup" | "organization";

const SHOWN_CHECKS = ["database", "fileStorage", "clock", "reachability", "https"] as const;

export function checkSummary(checks: SetupStepDetails<"systemCheck">["checks"]) {
  const shown = SHOWN_CHECKS.map((key) => ({ key, status: checks[key].status }));
  return {
    ok: shown.filter((check) => check.status === "ok").length,
    warnings: shown.filter((check) => check.status === "warning").map((check) => check.key),
    infos: shown.filter((check) => check.status === "info").map((check) => check.key),
    errors: shown.filter((check) => check.status === "error").map((check) => check.key),
  };
}

export function SummaryStep({
  steps,
  back,
  onChange,
  onRecheck,
  onFinished,
}: {
  steps: readonly SetupStepState[];
  back: ReactNode;
  onChange: (page: SetupPage) => void;
  onRecheck: () => Promise<void>;
  onFinished: (finished: { organizationId: string | null; mailConfigured: boolean }) => void;
}) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const instance = stepDetails(steps, "instance");
  const system = stepDetails(steps, "systemCheck");
  const owner = stepDetails(steps, "owner");
  const organization = stepDetails(steps, "organization")?.organization ?? null;
  const formats = stepDetails(steps, "organization")?.formats ?? null;
  const keysStored = steps.find((step) => step.id === "keyBackup")?.completed ?? false;
  const checks = system ? checkSummary(system.checks) : null;
  const checkName = (key: string) => t(`setup.systemCheck.checks.${key}` as "setup.systemCheck.checks.https");

  const finish = async () => {
    setError(null);
    setBusy(true);
    try {
      const completed = await request(() => api.POST("/api/v1/setup/complete"), { sessionHandling: false });
      onFinished({ organizationId: organization?.id ?? null, mailConfigured: completed.mailConfigured });
    } catch (failure) {
      setError(problemMessage(t, failure));
      setBusy(false);
    }
  };

  return (
    <>
      {error ? (
        <Notice variant="danger" title={t("failures.finishSetup")}>
          {error}
        </Notice>
      ) : null}
      <div className="flex flex-col">
        {instance ? (
          <SummarySection
            title={t("setup.steps.instance")}
            action={
              instance.urlFromEnvironment ? null : (
                <ChangeButton section={t("setup.steps.instance")} onClick={() => onChange("instance")} />
              )
            }
          >
            <SummaryRow
              label={t("setup.instance.url")}
              value={instance.urlFromEnvironment ? (instance.suggestedUrl ?? instance.url) : instance.url}
              locked={instance.urlFromEnvironment}
            />
            <SummaryRow label={t("setup.instance.name")} value={instance.name} />
          </SummarySection>
        ) : null}
        {checks ? (
          <SummarySection
            title={t("setup.steps.systemCheck")}
            action={
              <Button
                variant="ghost"
                size="sm"
                icon={RotateCcw}
                loading={checking}
                onClick={() => {
                  setChecking(true);
                  void onRecheck().finally(() => setChecking(false));
                }}
              >
                {t("setup.systemCheck.checkAgain")}
              </Button>
            }
          >
            <SummaryRow
              label={t("setup.summary.result")}
              value={[
                t("setup.summary.checksOk", { count: checks.ok }),
                ...(checks.warnings.length > 0
                  ? [
                      t("setup.summary.checksWarning", {
                        count: checks.warnings.length,
                        names: checks.warnings.map(checkName).join(", "),
                      }),
                    ]
                  : []),
                ...(checks.infos.length > 0
                  ? [
                      t("setup.summary.checksInfo", {
                        count: checks.infos.length,
                        names: checks.infos.map(checkName).join(", "),
                      }),
                    ]
                  : []),
              ].join(", ")}
            />
          </SummarySection>
        ) : null}
        {owner?.owner ? (
          <SummarySection
            title={t("setup.steps.owner")}
            action={<ChangeButton section={t("setup.steps.owner")} onClick={() => onChange("owner")} />}
          >
            <SummaryRow label={t("setup.summary.name")} value={owner.owner.name} />
            <SummaryRow label={t("setup.summary.email")} value={owner.owner.email ?? ""} />
            <SummaryRow
              label={t("setup.summary.secondFactor")}
              value={owner.totpConfirmed ? t("setup.summary.authenticatorApp") : t("setup.summary.missing")}
            />
          </SummarySection>
        ) : null}
        <SummarySection
          title={t("setup.steps.keyBackup")}
          action={<ChangeButton section={t("setup.steps.keyBackup")} onClick={() => onChange("keyBackup")} />}
        >
          <SummaryRow
            label={t("setup.summary.keysStored")}
            value={keysStored ? t("setup.summary.keysConfirmed") : t("setup.summary.missing")}
          />
        </SummarySection>
        {organization ? (
          <SummarySection
            title={t("setup.steps.organization")}
            action={
              <ChangeButton
                section={t("setup.steps.organization")}
                onClick={() => onChange("organization")}
              />
            }
          >
            <SummaryRow label={t("setup.summary.name")} value={organization.name} />
            <SummaryRow
              label={t("setup.summary.languageAndTimeZone")}
              value={`${languageLabel(t, organization.language)}, ${timeZoneName(t, organization.timeZone)}`}
            />
            {formats ? (
              <SummaryRow
                label={t("setup.summary.formats")}
                value={formatsSuggestion(formats, i18n.language, t)}
              />
            ) : null}
          </SummarySection>
        ) : null}
      </div>
      <div className="flex justify-between gap-2">
        {back}
        <Button variant="primary" loading={busy} onClick={() => void finish()}>
          {t("setup.finish")}
        </Button>
      </div>
    </>
  );
}

function ChangeButton({ section, onClick }: { section: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="inline-flex min-h-hit items-center rounded-sm px-1 font-medium text-accent text-sm hover:underline focus-visible:focus-ring"
      aria-label={t("setup.summary.changeSection", { section })}
      onClick={onClick}
    >
      {t("setup.summary.change")}
    </button>
  );
}

function SummarySection({
  title,
  action,
  children,
}: {
  title: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1 border-border border-t py-3" aria-label={title}>
      <div className="flex min-h-hit items-center gap-2">
        <h2 className="min-w-0 flex-1 font-semibold">{title}</h2>
        {action}
      </div>
      <dl className="flex flex-col gap-1 text-sm">{children}</dl>
    </section>
  );
}

function SummaryRow({ label, value, locked = false }: { label: string; value: string; locked?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-x-4 sm:flex-row">
      <dt className="shrink-0 text-text-muted sm:w-field">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2">
        {locked ? (
          <>
            <Icon icon={Lock} size="sm" className="text-text-muted" />
            <span className="sr-only">{t("setup.instance.locked")}</span>
          </>
        ) : null}
        <span className="min-w-0 break-words">{value}</span>
      </dd>
    </div>
  );
}
