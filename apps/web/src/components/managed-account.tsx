import { TruncatedText } from "@lunedo/ui";
import { useTranslation } from "react-i18next";

export function SignInThrough({ managedBy }: { managedBy: { providerName: string } | null | undefined }) {
  const { t } = useTranslation();
  if (!managedBy) return <span className="text-text-muted">{t("managedAccounts.local")}</span>;
  return <TruncatedText text={managedBy.providerName} />;
}
