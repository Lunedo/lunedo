import { Button, ButtonGroup, Checkbox, Notice, useToast } from "@pagehall/ui";
import { Copy, Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { downloadText } from "../../../components/download.js";
import { problemMessage } from "../../../errors/problem-message.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

const KEY_FILE = "pagehall-keys.env";

export function KeyBackupStep({ details, back, onDone, refresh }: StepProps<"keyBackup">) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [content, setContent] = useState<string | null>(null);
  const [stored, setStored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setError(null);
    setBusy(true);
    try {
      const text = await runSetupAction("keyBackup", "download", {});
      setContent(text);
      downloadText(KEY_FILE, text);
      await refresh();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
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

  const keys = content
    ?.split("\n")
    .filter((line) => line.startsWith("PAGEHALL_"))
    .join("\n");

  return (
    <div className="flex flex-col gap-4">
      {error ? <Notice variant="danger">{error}</Notice> : null}
      {details.downloaded && !content ? (
        <Notice variant="info">{t("setup.keyBackup.alreadyDownloaded")}</Notice>
      ) : null}
      {keys ? (
        <figure aria-label={t("setup.keyBackup.keys")}>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-sunken p-3 font-mono text-sm">
            {keys}
          </pre>
        </figure>
      ) : null}
      <ButtonGroup label={t("setup.keyBackup.keys")}>
        {!details.downloaded ? (
          <Button variant="outline" icon={Download} loading={busy} onClick={() => void download()}>
            {t("setup.keyBackup.download")}
          </Button>
        ) : null}
        {content ? (
          <>
            <Button variant="outline" icon={Download} onClick={() => downloadText(KEY_FILE, content)}>
              {t("setup.keyBackup.saveAgain")}
            </Button>
            <Button
              variant="outline"
              icon={Copy}
              onClick={() => {
                navigator.clipboard.writeText(content).then(
                  () => toast({ title: t("setup.keyBackup.copied"), variant: "success" }),
                  () => toast({ title: t("common.copyFailed"), variant: "error" }),
                );
              }}
            >
              {t("common.copy")}
            </Button>
          </>
        ) : null}
      </ButtonGroup>
      <Checkbox
        checked={stored}
        onCheckedChange={(checked) => setStored(checked === true)}
        label={t("setup.keyBackup.stored")}
        disabled={!details.downloaded}
      />
      <div className="flex justify-between gap-2">
        {back}
        <Button
          variant="primary"
          loading={busy}
          disabled={!details.downloaded || !stored}
          onClick={() => void confirm()}
        >
          {t("setup.continue")}
        </Button>
      </div>
    </div>
  );
}
