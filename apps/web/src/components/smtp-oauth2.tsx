import { microsoftAuthorities, type SmtpOAuth2Provider } from "@pagehall/shared";
import { CopyButton, Notice } from "@pagehall/ui";
import { useTranslation } from "react-i18next";

export const GOOGLE_MAIL_SCOPE = "https://mail.google.com/";

export const CLOUDS: Record<(typeof microsoftAuthorities)[number], "global" | "usGovernment" | "china"> = {
  "https://login.microsoftonline.com": "global",
  "https://login.microsoftonline.us": "usGovernment",
  "https://login.partner.microsoftonline.cn": "china",
};

export interface ServiceAccountKey {
  clientEmail: string;
  clientId: string;
}

export function readServiceAccountKey(text: string): ServiceAccountKey | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (
      parsed.type !== "service_account" ||
      typeof parsed.client_email !== "string" ||
      typeof parsed.client_id !== "string" ||
      typeof parsed.private_key !== "string"
    ) {
      return null;
    }
    return { clientEmail: parsed.client_email.toLowerCase(), clientId: parsed.client_id };
  } catch {
    return null;
  }
}

function CopyLine({ value, name }: { value: string; name: string }) {
  const { t } = useTranslation();
  return (
    <span className="mt-1 flex items-start gap-1 rounded-sm bg-surface-sunken px-2 py-1">
      <code className="min-w-0 flex-1 font-mono text-sm wrap-anywhere">{value}</code>
      <CopyButton value={value} label={t("mail.oauth2.copyValue", { name })} />
    </span>
  );
}

export function OAuth2Steps({
  provider,
  mailbox,
  clientId,
}: {
  provider: SmtpOAuth2Provider;
  mailbox: string;
  clientId: string;
}) {
  const { t } = useTranslation();
  const providerName = t(`mail.oauth2.providers.${provider}`);
  const box = mailbox.trim() || t("mail.oauth2.placeholders.mailbox");
  const app = clientId.trim() || t("mail.oauth2.placeholders.application");
  const objectId = t("mail.oauth2.placeholders.objectId");
  return (
    <Notice variant="info" title={t("mail.oauth2.steps.title", { provider: providerName })}>
      {provider === "microsoft365" ? (
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>{t("mail.oauth2.steps.microsoft365.register")}</li>
          <li>{t("mail.oauth2.steps.microsoft365.permission")}</li>
          <li>{t("mail.oauth2.steps.microsoft365.secret")}</li>
          <li>
            {t("mail.oauth2.steps.microsoft365.exchange")}
            <CopyLine
              name="New-ServicePrincipal"
              value={`New-ServicePrincipal -AppId ${app} -ObjectId ${objectId}`}
            />
            <CopyLine
              name="Add-MailboxPermission"
              value={`Add-MailboxPermission -Identity ${box} -User ${app} -AccessRights FullAccess`}
            />
            <CopyLine
              name="Set-CASMailbox"
              value={`Set-CASMailbox -Identity ${box} -SmtpClientAuthenticationDisabled $false`}
            />
          </li>
        </ol>
      ) : null}
      {provider === "google" ? (
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li>{t("mail.oauth2.steps.google.account")}</li>
          <li>
            {t("mail.oauth2.steps.google.delegation")}
            <CopyLine name={t("mail.oauth2.scope")} value={GOOGLE_MAIL_SCOPE} />
            <span className="mt-1 block text-sm text-text-muted">{t("mail.oauth2.steps.google.delay")}</span>
          </li>
        </ol>
      ) : null}
      {provider === "generic" ? <p>{t("mail.oauth2.steps.generic.grant")}</p> : null}
    </Notice>
  );
}
