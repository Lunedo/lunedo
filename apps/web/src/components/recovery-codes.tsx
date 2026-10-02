import { Button, ButtonGroup, Notice, useToast } from "@pagehall/ui";
import { Copy, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { downloadText } from "./download.js";

export function RecoveryCodes({ codes }: { codes: readonly string[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const text = `${codes.join("\n")}\n`;
  return (
    <div className="flex flex-col gap-3">
      <Notice variant="warning" title={t("security.recoveryCodesShownOnce")}>
        {t("security.recoveryCodesDescription")}
      </Notice>
      <ul
        aria-label={t("security.recoveryCodes")}
        className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-sunken p-3 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <ButtonGroup label={t("security.recoveryCodes")}>
        <Button
          variant="outline"
          icon={Copy}
          onClick={() => {
            navigator.clipboard.writeText(text).then(
              () => toast({ title: t("security.recoveryCodesCopied"), variant: "success" }),
              () => toast({ title: t("common.copyFailed"), variant: "error" }),
            );
          }}
        >
          {t("common.copy")}
        </Button>
        <Button
          variant="outline"
          icon={Download}
          onClick={() => downloadText("pagehall-recovery-codes.txt", text)}
        >
          {t("common.download")}
        </Button>
      </ButtonGroup>
    </div>
  );
}
