import { Button } from "@pagehall/ui";
import { ExternalLink } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export function PortalLink({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const reason = useId();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        size={compact ? "sm" : undefined}
        icon={ExternalLink}
        disabled
        aria-describedby={reason}
      >
        {t("knowledgeBase.portal.view")}
      </Button>
      <span id={reason} className="text-xs text-text-muted">
        {t("knowledgeBase.portal.notYet")}
      </span>
    </span>
  );
}
