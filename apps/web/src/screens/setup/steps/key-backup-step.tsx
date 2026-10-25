import type { SetupActionResult } from "@lunedo/shared";
import { Button, Checkbox, CodeBlock, Icon, Notice } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { CircleAlert, Download } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadText } from "../../../components/download.js";
import { problemMessage } from "../../../errors/problem-message.js";
import type { Formatter } from "../../../format/format.js";
import { useFormat } from "../../../preferences/preferences-provider.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

export type EmergencyKit = SetupActionResult<"keyBackup", "download">;

export function emergencyKitFileName(t: TFunction, kit: EmergencyKit): string {
  const host = URL.canParse(kit.instanceUrl)
    ? new URL(kit.instanceUrl).host.replace(/[^A-Za-z0-9.-]+/g, "-")
    : "lunedo";
  return t("setup.keyBackup.fileName", { host });
}

export function emergencyKitText(t: TFunction, format: Formatter, kit: EmergencyKit): string {
  const section = (title: string, purpose: string, lines: readonly string[]) =>
    [`== ${title} ==`, purpose, "", ...lines].join("\n");
  return `${[
    t("setup.keyBackup.kit.heading"),
    t("setup.keyBackup.kit.created", { date: format.dateTime(kit.createdAt) }),
    t("setup.keyBackup.kit.keepSafe"),
    section(t("setup.keyBackup.kit.instanceUrl"), t("setup.keyBackup.kit.instanceUrlPurpose"), [
      kit.instanceUrl,
    ]),
    section(
      t("setup.keyBackup.kit.recoveryCodes"),
      t("setup.keyBackup.kit.recoveryCodesPurpose"),
      kit.recoveryCodes,
    ),
    section("LUNEDO_MASTER_KEYS", t("setup.keyBackup.kit.masterKeysPurpose"), [
      `LUNEDO_MASTER_KEYS=${kit.masterKeys}`,
    ]),
    section("LUNEDO_BACKUP_KEY", t("setup.keyBackup.kit.backupKeyPurpose"), [
      `LUNEDO_BACKUP_KEY=${kit.backupKey}`,
    ]),
  ].join("\n\n")}\n`;
}

function KeyValue({ name, value }: { name: string; value: string }) {
  return (
    <span className="block">
      <span className="block text-text-muted">{name}</span>
      <span className="block">
        {value.slice(0, -4)}
        <span className="whitespace-nowrap">{value.slice(-4)}</span>
      </span>
    </span>
  );
}

function KitBox({ kit, text }: { kit: EmergencyKit; text: string }) {
  const { t } = useTranslation();
  return (
    <CodeBlock value={text} copyLabel={t("setup.keyBackup.copy")} label={t("setup.keyBackup.kit.heading")}>
      <span className="block text-text-muted">{t("setup.keyBackup.kit.recoveryCodes")}</span>
      <span className="mb-3 grid grid-cols-2 gap-x-4">
        {kit.recoveryCodes.map((code) => (
          <span key={code}>{code}</span>
        ))}
      </span>
      <span className="flex flex-col gap-3">
        <KeyValue name="LUNEDO_MASTER_KEYS" value={kit.masterKeys} />
        <KeyValue name="LUNEDO_BACKUP_KEY" value={kit.backupKey} />
      </span>
    </CodeBlock>
  );
}

export function KeyBackupStep({ details, back, onDone, refresh }: StepProps<"keyBackup">) {
  const { t } = useTranslation();
  const format = useFormat();
  const [kit, setKit] = useState<EmergencyKit | null>(null);
  const [stored, setStored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"download" | "stored" | null>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);
  const storedRef = useRef<HTMLDivElement>(null);
  const text = kit ? emergencyKitText(t, format, kit) : null;

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await runSetupAction("keyBackup", "download", {});
      setKit(result);
      downloadText(emergencyKitFileName(t, result), emergencyKitText(t, format, result));
      await refresh();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!details.downloaded) {
      setProblem("download");
      downloadRef.current?.focus();
      return;
    }
    if (!stored) {
      setProblem("stored");
      storedRef.current?.querySelector("button")?.focus();
      return;
    }
    setProblem(null);
    setError(null);
    setBusy(true);
    try {
      await runSetupAction("keyBackup", "confirm", {});
      await onDone();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Notice variant="danger" title={t("failures.keyBackup")}>
          {error}
        </Notice>
      ) : null}
      {details.downloaded && !kit ? (
        <Notice variant="info">{t("setup.keyBackup.alreadyDownloaded")}</Notice>
      ) : null}
      {kit && text ? (
        <>
          <KitBox kit={kit} text={text} />
          <div>
            <Button
              variant="outline"
              icon={Download}
              onClick={() => downloadText(emergencyKitFileName(t, kit), text)}
            >
              {t("setup.keyBackup.saveAgain")}
            </Button>
          </div>
        </>
      ) : null}
      {!details.downloaded ? (
        <div>
          <Button
            ref={downloadRef}
            variant="outline"
            icon={Download}
            loading={busy}
            aria-describedby={problem === "download" ? "key-download-problem" : undefined}
            onClick={() => void download()}
          >
            {t("setup.keyBackup.download")}
          </Button>
        </div>
      ) : null}
      {problem === "download" && !details.downloaded ? (
        <p id="key-download-problem" className="text-sm text-danger">
          <Icon icon={CircleAlert} size="sm" className="mr-1 inline align-text-bottom" />
          {t("setup.keyBackup.downloadFirst")}
        </p>
      ) : null}
      <div ref={storedRef}>
        <Checkbox
          checked={stored}
          onCheckedChange={(checked) => {
            setStored(checked === true);
            if (checked === true) setProblem(null);
          }}
          label={t("setup.keyBackup.stored")}
          {...(problem === "stored" && !stored ? { error: t("setup.keyBackup.confirmStored") } : {})}
        />
      </div>
      <div className="flex justify-between gap-2">
        {back}
        <Button variant="primary" loading={busy} onClick={() => void confirm()}>
          {t("setup.continue")}
        </Button>
      </div>
    </div>
  );
}
