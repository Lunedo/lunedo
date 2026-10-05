import { Button, ButtonGroup, Checkbox, Icon, Notice, useToast } from "@pagehall/ui";
import { CircleAlert, Copy, Download } from "lucide-react";
import { useRef, useState } from "react";
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
  const [problem, setProblem] = useState<"download" | "stored" | null>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);
  const storedRef = useRef<HTMLDivElement>(null);

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

  const keys = content
    ?.split("\n")
    .filter((line) => line.startsWith("PAGEHALL_"))
    .join("\n");

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Notice variant="danger" title={t("failures.keyBackup")}>
          {error}
        </Notice>
      ) : null}
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
