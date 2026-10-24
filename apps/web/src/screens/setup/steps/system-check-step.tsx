import type { SetupStepDetails } from "@lunedo/shared";
import { Badge, Button, ErrorState, List, ListRow, Notice } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { CircleAlert, CircleCheck, CircleX, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { docsUrl } from "../../../docs/docs-url.js";
import { FailureNotice } from "../../../errors/failure.js";
import type { Formatter } from "../../../format/format.js";
import { translateKey } from "../../../i18n/translate.js";
import { useFormat } from "../../../preferences/preferences-provider.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

type Status = "ok" | "warning" | "error";
type Checks = SetupStepDetails<"systemCheck">["checks"];
type CheckKey = keyof Checks;

const ICONS = { ok: CircleCheck, warning: CircleAlert, error: CircleX } as const;
const BADGES = { ok: "success", warning: "warning", error: "danger" } as const;
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
      return t("setup.systemCheck.reachabilityOk", { url: checks.reachability.url ?? "" });
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
  if (check.status === "ok" || check.cause === null) return null;
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

export function SystemCheckStep({ details, back, onDone, refresh }: StepProps<"systemCheck">) {
  const { t } = useTranslation();
  const format = useFormat();
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState<CheckKey | "all" | null>(null);
  const { checks } = details;
  const blocked = CHECK_ORDER.some((key) => checks[key].status === "error");

  const checkAgain = async (key: CheckKey | "all") => {
    setChecking(key);
    try {
      await refresh();
    } finally {
      setChecking(null);
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
      <List>
        {CHECK_ORDER.map((key) => {
          const check = checks[key];
          const status: Status = check.status;
          const title = translateKey(t, `setup.systemCheck.checks.${key}`);
          const explanation = checkExplanation(t, format, checks, key);
          return (
            <ListRow
              key={key}
              icon={ICONS[status]}
              title={title}
              description={explanation ? null : passedDescription(t, format, checks, key)}
              actions={<Badge variant={BADGES[status]}>{t(`setup.systemCheck.status.${status}`)}</Badge>}
            >
              {explanation ? (
                <ErrorState
                  variant={status === "error" ? "danger" : "warning"}
                  title={t("setup.systemCheck.failedTitle", { check: title })}
                  cause={explanation.cause}
                  action={explanation.action}
                  {...(check.fixCommand ? { command: check.fixCommand } : {})}
                  documentationUrl={docsUrl(check.docs)}
                  {...(key === "https" ? { documentationLabel: t("setup.systemCheck.httpsGuide") } : {})}
                  onRetry={() => void checkAgain(key)}
                  retryLabel={
                    checking === key ? t("setup.systemCheck.checking") : t("setup.systemCheck.checkAgain")
                  }
                />
              ) : null}
            </ListRow>
          );
        })}
      </List>
      <div>
        <Button
          variant="outline"
          icon={RotateCcw}
          loading={checking === "all"}
          onClick={() => void checkAgain("all")}
        >
          {t("setup.systemCheck.checkAllAgain")}
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
