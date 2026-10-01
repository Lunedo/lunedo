import { Notice, Section, Skeleton, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceKeys, mailQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { SmtpForm } from "../../components/smtp-form.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function InstanceMailScreen() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const state = useOrganizationState();
  const mail = useQuery(mailQuery);
  const manage = state.can("instance.settings.manage");
  return (
    <SettingsPage title={t("mail.title")} description={t("mail.description")} icon={Mail}>
      {mail.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {mail.isError ? <Notice variant="danger">{problemMessage(t, mail.error)}</Notice> : null}
      {mail.data && !mail.data.smtp ? <Notice variant="warning">{t("mail.notConfigured")}</Notice> : null}
      {mail.data ? (
        <Section title={t("mail.smtp")}>
          <div className="p-4">
            {manage ? (
              <SmtpForm
                initial={mail.data.smtp}
                passwordSet={mail.data.passwordSet}
                saveLabel={t("common.save")}
                defaultRecipient={session.account?.email ?? ""}
                onSave={async (input) => {
                  await request(() => api.PUT("/api/v1/instance/mail", { body: input }));
                  await queryClient.invalidateQueries({ queryKey: instanceKeys.mail });
                  toast({ title: t("common.saved"), variant: "success" });
                }}
                onTest={(input) => request(() => api.POST("/api/v1/instance/mail/test", { body: input }))}
              />
            ) : (
              <p className="text-text-muted">
                {mail.data.smtp
                  ? `${mail.data.smtp.host}:${mail.data.smtp.port} · ${mail.data.smtp.from}`
                  : t("mail.notConfigured")}
              </p>
            )}
          </div>
        </Section>
      ) : null}
    </SettingsPage>
  );
}
