import type { SetupStepDetails } from "@lunedo/shared";
import { Button, Notice } from "@lunedo/ui";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../api/client.js";
import { request } from "../../../api/request.js";
import { problemMessage } from "../../../errors/problem-message.js";
import { languageLabel } from "../../../settings/locale-options.js";
import { type SetupStepState, stepDetails } from "../setup-api.js";

type SetupPage = "instance" | "systemCheck" | "owner" | "keyBackup" | "organization";

const SHOWN_CHECKS = ["database", "fileStorage", "clock", "reachability", "https"] as const;

export function checkSummary(checks: SetupStepDetails<"systemCheck">["checks"]) {
  const shown = SHOWN_CHECKS.map((key) => ({ key, status: checks[key].status }));
  return {
    ok: shown.filter((check) => check.status === "ok").length,
    warnings: shown.filter((check) => check.status === "warning").map((check) => check.key),
    errors: shown.filter((check) => check.status === "error").map((check) => check.key),
  };
}

export function SummaryStep({
  steps,
  back,
  onChange,
  onFinished,
}: {
  steps: readonly SetupStepState[];
  back: ReactNode;
  onChange: (page: SetupPage) => void;
  onFinished: (organizationId: string | null) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const instance = stepDetails(steps, "instance");
  const system = stepDetails(steps, "systemCheck");
  const owner = stepDetails(steps, "owner");
  const organization = stepDetails(steps, "organization")?.organization ?? null;
  const keysStored = steps.find((step) => step.id === "keyBackup")?.completed ?? false;
  const checks = system ? checkSummary(system.checks) : null;
  const checkName = (key: string) => t(`setup.systemCheck.checks.${key}` as "setup.systemCheck.checks.https");

  const finish = async () => {
    setError(null);
    setBusy(true);
    try {
      await request(() => api.POST("/api/v1/setup/complete"), { sessionHandling: false });
      onFinished(organization?.id ?? null);
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
          <SummarySection title={t("setup.steps.instance")} onChange={() => onChange("instance")}>
            <SummaryRow label={t("setup.instance.url")} value={instance.url} />
            <SummaryRow label={t("setup.instance.name")} value={instance.name} />
          </SummarySection>
        ) : null}
        {checks ? (
          <SummarySection title={t("setup.steps.systemCheck")} onChange={() => onChange("systemCheck")}>
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
              ].join(", ")}
            />
          </SummarySection>
        ) : null}
        {owner?.owner ? (
          <SummarySection title={t("setup.steps.owner")} onChange={() => onChange("owner")}>
            <SummaryRow label={t("setup.summary.name")} value={owner.owner.name} />
            <SummaryRow label={t("setup.summary.email")} value={owner.owner.email ?? ""} />
            <SummaryRow
              label={t("setup.summary.secondFactor")}
              value={owner.totpConfirmed ? t("setup.summary.authenticatorApp") : t("setup.summary.missing")}
            />
          </SummarySection>
        ) : null}
        <SummarySection title={t("setup.steps.keyBackup")} onChange={() => onChange("keyBackup")}>
          <SummaryRow
            label={t("setup.summary.keysStored")}
            value={keysStored ? t("setup.summary.keysConfirmed") : t("setup.summary.missing")}
          />
        </SummarySection>
        {organization ? (
          <SummarySection title={t("setup.steps.organization")} onChange={() => onChange("organization")}>
            <SummaryRow label={t("setup.summary.name")} value={organization.name} />
            <SummaryRow
              label={t("setup.summary.languageAndTimeZone")}
              value={`${languageLabel(t, organization.language)}, ${organization.timeZone}`}
            />
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

function SummarySection({
  title,
  onChange,
  children,
}: {
  title: string;
  onChange: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-1 border-border border-t py-3" aria-label={title}>
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 font-semibold">{title}</h2>
        <button
          type="button"
          className="inline-flex min-h-hit items-center rounded-sm px-1 font-medium text-accent text-sm hover:underline focus-visible:focus-ring"
          aria-label={t("setup.summary.changeSection", { section: title })}
          onClick={onChange}
        >
          {t("setup.summary.change")}
        </button>
      </div>
      <dl className="flex flex-col gap-1 text-sm">{children}</dl>
    </section>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-x-4 sm:flex-row">
      <dt className="shrink-0 text-text-muted sm:w-field">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}
