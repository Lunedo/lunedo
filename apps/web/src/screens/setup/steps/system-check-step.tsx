import { Badge, Button, Field, List, ListRow, Notice, Select } from "@pagehall/ui";
import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../../../errors/problem-message.js";
import { isLanguage, rememberLanguage, supportedLanguages } from "../../../i18n/index.js";
import { translateKey } from "../../../i18n/translate.js";
import { useFormat } from "../../../preferences/preferences-provider.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

type Status = "ok" | "warning" | "error";

const ICONS = { ok: CircleCheck, warning: CircleAlert, error: CircleX } as const;
const BADGES = { ok: "success", warning: "warning", error: "danger" } as const;

export function SystemCheckStep({ details, back, onDone }: StepProps<"systemCheck">) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { checks } = details;
  const rows: { key: string; status: Status; description: string }[] = [
    {
      key: "database",
      status: checks.database.status,
      description: checks.database.migrationsUpToDate
        ? t("setup.systemCheck.databaseOk", { version: checks.database.version ?? "" })
        : t("setup.systemCheck.databaseMigrations"),
    },
    {
      key: "fileStorage",
      status: checks.fileStorage.status,
      description: checks.fileStorage.writable
        ? t("setup.systemCheck.storageFree", { free: format.bytes(checks.fileStorage.freeBytes ?? 0) })
        : t("setup.systemCheck.storageNotWritable"),
    },
    {
      key: "clock",
      status: checks.clock.status,
      description:
        checks.clock.status === "ok"
          ? t("setup.systemCheck.clockOk")
          : t("setup.systemCheck.clockOffset", { seconds: Math.round((checks.clock.offsetMs ?? 0) / 1000) }),
    },
    {
      key: "instanceUrl",
      status: checks.instanceUrl.status,
      description: checks.instanceUrl.configured
        ? t("setup.systemCheck.urlOk")
        : t("setup.systemCheck.urlMissing"),
    },
    {
      key: "https",
      status: checks.https.status,
      description:
        checks.https.status === "ok" ? t("setup.systemCheck.httpsOk") : t("setup.systemCheck.httpsMissing"),
    },
  ];
  const blocked = rows.some((row) => row.status === "error");

  const acknowledge = async () => {
    setError(null);
    setBusy(true);
    try {
      await runSetupAction("systemCheck", "acknowledge", {});
      await onDone();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label={t("setup.systemCheck.language")}>
        <Select
          value={i18n.language}
          onValueChange={(language) => {
            if (!isLanguage(language)) return;
            rememberLanguage(language);
            void i18n.changeLanguage(language);
          }}
          options={supportedLanguages.map((language) => ({
            value: language,
            label: t(`languages.${language}`),
          }))}
        />
      </Field>
      <List>
        {rows.map((row) => {
          const Icon = ICONS[row.status];
          return (
            <ListRow
              key={row.key}
              icon={Icon}
              title={translateKey(t, `setup.systemCheck.checks.${row.key}`)}
              description={row.description}
              actions={
                <Badge variant={BADGES[row.status]}>{t(`setup.systemCheck.status.${row.status}`)}</Badge>
              }
            />
          );
        })}
      </List>
      {blocked ? <Notice variant="danger">{t("setup.systemCheck.blocked")}</Notice> : null}
      {error ? <Notice variant="danger">{error}</Notice> : null}
      <div className="flex justify-between gap-2">
        {back}
        <Button variant="primary" loading={busy} disabled={blocked} onClick={() => void acknowledge()}>
          {t("setup.continue")}
        </Button>
      </div>
    </div>
  );
}
