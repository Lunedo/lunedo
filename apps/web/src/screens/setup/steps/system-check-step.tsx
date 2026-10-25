import type { SetupStepDetails } from "@lunedo/shared";
import { Badge, Button, CodeBlock, Icon, List, Notice } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { CircleAlert, CircleCheck, CircleX, ExternalLink, Info, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { docsUrl } from "../../../docs/docs-url.js";
import { FailureNotice } from "../../../errors/failure.js";
import type { Formatter } from "../../../format/format.js";
import { translateKey } from "../../../i18n/translate.js";
import { useFormat } from "../../../preferences/preferences-provider.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

type Status = "ok" | "warning" | "error" | "info";
type Checks = SetupStepDetails<"systemCheck">["checks"];
type CheckKey = keyof Checks;

const ICONS = { ok: CircleCheck, warning: CircleAlert, error: CircleX, info: Info } as const;
const BADGES = { ok: "success", warning: "warning", error: "danger", info: "info" } as const;
const CHECK_ORDER = ["database", "fileStorage", "clock", "reachability", "https"] as const;
type ShownCheck = (typeof CHECK_ORDER)[number];

function unknownId(t: TFunction, id: number | null): string {
  return id === null ? t("setup.systemCheck.unknownId") : String(id);
}

function passedDescription(t: TFunction, format: Formatter, checks: Checks, key: ShownCheck): string {
  switch (key) {
    case "database":
      return t("setup.systemCheck.databaseOk", { version: checks.database.version ?? "" });
    case "fileStorage":
      return t("setup.systemCheck.storageFree", { free: format.bytes(checks.fileStorage.freeBytes ?? 0) });
    case "clock":
      return t("setup.systemCheck.clockOk");
    case "reachability":
      return checks.reachability.cause === "loopback"
        ? t("setup.systemCheck.reachabilityLocal")
        : t("setup.systemCheck.reachabilityOk", { url: checks.reachability.url ?? "" });
    case "https":
      return t("setup.systemCheck.httpsOk");
  }
}

export function checkExplanation(
  t: TFunction,
  format: Formatter,
  checks: Checks,
  key: CheckKey,
): { cause: string; action: string } | null {
  const check = checks[key];
  if (check.status === "ok" || check.status === "info" || check.cause === null) return null;
  const storage = checks.fileStorage;
  const values: Record<string, string | number> = {
    path: storage.path,
    processUid: unknownId(t, storage.processUid),
    ownerUid: unknownId(t, storage.ownerUid),
    free: format.bytes(storage.freeBytes ?? 0),
    minimum: format.bytes(storage.minimumFreeBytes),
    seconds: Math.round(Math.abs(checks.clock.offsetMs ?? 0) / 1000),
    tolerance: Math.round(checks.clock.toleranceMs / 1000),
    url: checks.reachability.url ?? "",
  };
  const base = `setup.systemCheck.causes.${key}.${check.cause}`;
  return {
    cause: translateKey(t, `${base}.cause`, values),
    action: translateKey(t, `${base}.action`, values),
  };
}

function CheckDetails({
  explanation,
  command,
  docs,
  https,
}: {
  explanation: { cause: string; action: string };
  command: string | null;
  docs: string;
  https: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-1 flex flex-col gap-2">
      <p>{explanation.cause}</p>
      <p>{explanation.action}</p>
      {command ? <CodeBlock value={command} copyLabel={t("setup.systemCheck.copyCommand")} /> : null}
      <a
        href={docsUrl(docs)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex w-fit items-center gap-1 rounded-sm text-accent underline-offset-2 hover:underline focus-visible:focus-ring"
      >
        {https ? t("setup.systemCheck.httpsGuide") : t("setup.systemCheck.docs")}
        <Icon icon={ExternalLink} size="sm" />
      </a>
    </div>
  );
}

export function SystemCheckStep({ details, back, onDone, refresh }: StepProps<"systemCheck">) {
  const { t } = useTranslation();
  const format = useFormat();
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const { checks } = details;
  const blocked = CHECK_ORDER.some((key) => checks[key].status === "error");

  const checkAgain = async () => {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  const acknowledge = async () => {
    setFailure(null);
    setBusy(true);
    try {
      await runSetupAction("systemCheck", "acknowledge", {});
      await onDone();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <List label={t("setup.systemCheck.title")}>
        {CHECK_ORDER.map((key) => {
          const check = checks[key];
          const status: Status = check.status;
          const explanation = checkExplanation(t, format, checks, key);
          return (
            <li key={key} className="flex items-start gap-3 py-3">
              <span className="flex h-6 items-center">
                <Icon icon={ICONS[status]} className="text-text-muted" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium text-text">
                  {translateKey(t, `setup.systemCheck.checks.${key}`)}
                </span>
                <div className="text-sm text-text-muted">
                  {explanation ? (
                    <CheckDetails
                      explanation={explanation}
                      command={check.fixCommand}
                      docs={check.docs}
                      https={key === "https"}
                    />
                  ) : (
                    passedDescription(t, format, checks, key)
                  )}
                </div>
              </div>
              <Badge variant={BADGES[status]}>{t(`setup.systemCheck.status.${status}`)}</Badge>
            </li>
          );
        })}
      </List>
      <div>
        <Button variant="outline" icon={RotateCcw} loading={checking} onClick={() => void checkAgain()}>
          {t("setup.systemCheck.checkAgain")}
        </Button>
      </div>
      {blocked ? <Notice variant="danger">{t("setup.systemCheck.blocked")}</Notice> : null}
      {failure ? (
        <FailureNotice
          what={t("setup.systemCheck.acknowledgeFailed")}
          error={failure}
          onRetry={() => void acknowledge()}
        />
      ) : null}
      <div className="flex justify-between gap-2">
        {back}
        <Button variant="primary" loading={busy} disabled={blocked} onClick={() => void acknowledge()}>
          {t("setup.continue")}
        </Button>
      </div>
    </div>
  );
}
