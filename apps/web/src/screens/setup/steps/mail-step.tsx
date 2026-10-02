import { Button, Notice } from "@pagehall/ui";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SmtpForm } from "../../../components/smtp-form.js";
import { runSetupAction } from "../setup-api.js";
import type { StepProps } from "./step-props.js";

export function MailStep({
  details,
  back,
  refresh,
  ready,
  finishing,
  onFinish,
}: StepProps<"mail"> & { ready: boolean; finishing: boolean; onFinish: () => void }) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      {saved ? <Notice variant="success">{t("setup.mail.saved")}</Notice> : null}
      <SmtpForm
        initial={details.smtp}
        passwordSet={details.passwordSet}
        saveLabel={t("setup.mail.save")}
        onSave={async (input) => {
          await runSetupAction("mail", "save", input);
          setSaved(true);
          await refresh();
        }}
        onTest={(input) => runSetupAction("mail", "test", input)}
      />
      {!ready ? <Notice variant="warning">{t("setup.notReady")}</Notice> : null}
      <div className="flex justify-between gap-2 border-border border-t pt-4">
        {back}
        <Button variant="primary" loading={finishing} disabled={!ready} onClick={onFinish}>
          {saved ? t("setup.finish") : t("setup.skipAndFinish")}
        </Button>
      </div>
    </div>
  );
}
