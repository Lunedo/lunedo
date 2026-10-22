import { Notice, Section, SegmentedControl, SettingRow, Skeleton, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { instanceKeys, mailQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { GraphMailForm } from "../../components/graph-mail-form.js";
import { mailFailure } from "../../components/mail-failure.js";
import { SmtpForm } from "../../components/smtp-form.js";
import { LoadError } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

type Method = "smtp" | "graph";

export function InstanceMailScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const session = useSession();
  const state = useOrganizationState();
  const mail = useQuery({ ...mailQuery, throwOnError: false });
  const manage = state.can("instance.settings.manage");
  const [shown, setShown] = useState<Method | null>(null);
  const data = mail.data;
  const method = shown ?? data?.method ?? "smtp";
  const configured = data ? (data.method === "graph" ? data.graph !== null : data.smtp !== null) : true;

  return (
    <SettingsPage title={t("mail.title")} description={t("mail.description")} icon={Mail}>
      {mail.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {mail.isError ? (
        <LoadError what={t("failures.loadMail")} error={mail.error} onRetry={() => mail.refetch()} />
      ) : null}
      {data && !configured ? <Notice variant="warning">{t("mail.notConfigured")}</Notice> : null}
      {data ? (
        <Section title={t("mail.methodTitle")}>
          <SettingRow
            label={t("mail.method")}
            description={t("mail.methodHint", { method: t(`mail.methods.${data.method}`) })}
            control={
              <SegmentedControl
                label={t("mail.method")}
                value={method}
                onValueChange={(value) => setShown(value as Method)}
                options={(["smtp", "graph"] as const).map((value) => ({
                  value,
                  label: t(`mail.methods.${value}`),
                }))}
              />
            }
          />
        </Section>
      ) : null}
      {data && method === "smtp" ? (
        <Section title={t("mail.smtp")}>
          <div className="p-4">
            {manage ? (
              <SmtpForm
                initial={data.smtp}
                passwordSet={data.passwordSet}
                oauth2SecretSet={data.oauth2SecretSet}
                saveLabel={t("common.save")}
                defaultRecipient={session.account?.email ?? ""}
                onSave={async (input) => {
                  await request(() => api.PUT("/api/v1/instance/mail", { body: input }));
                  if (data.method !== "smtp") {
                    await request(() =>
                      api.PUT("/api/v1/instance/mail/method", { body: { method: "smtp" } }),
                    );
                  }
                  await queryClient.invalidateQueries({ queryKey: instanceKeys.mail });
                  toast({ title: t("mail.smtpSaved"), variant: "success" });
                }}
                onTest={(input) => request(() => api.POST("/api/v1/instance/mail/test", { body: input }))}
              />
            ) : (
              <p className="text-text-muted">
                {data.smtp
                  ? `${data.smtp.host}:${data.smtp.port} · ${data.smtp.from}`
                  : t("mail.notConfigured")}
              </p>
            )}
          </div>
        </Section>
      ) : null}
      {data && method === "graph" ? (
        <Section title={t("mail.graph.title")}>
          <div className="p-4">
            {manage ? (
              <GraphMailForm
                initial={data.graph}
                credentials={data.graphCredentials}
                active={data.method === "graph"}
                defaultRecipient={session.account?.email ?? ""}
              />
            ) : (
              <p className="text-text-muted">{data.graph ? data.graph.sender : t("mail.notConfigured")}</p>
            )}
          </div>
        </Section>
      ) : null}
      {data ? (
        <Section title={t("mail.delivery.title")}>
          <SettingRow
            label={t("mail.delivery.lastFailure")}
            description={data.delivery.lastFailure ? t("mail.delivery.retry") : undefined}
            control={
              <span className="text-sm">
                {data.delivery.lastFailure
                  ? [
                      t("mail.delivery.lastFailureAt", {
                        date: format.dateTime(data.delivery.lastFailure.at),
                        cause: mailFailure(t, data.delivery.lastFailure, {
                          oauth2: data.method === "smtp" && data.smtp?.oauth2 != null,
                        }).cause,
                      }),
                      mailFailure(t, data.delivery.lastFailure).details,
                    ]
                      .filter((part) => part !== null)
                      .join(" · ")
                  : t("mail.delivery.noFailure")}
              </span>
            }
          />
          <SettingRow
            label={t("mail.delivery.lastSuccess")}
            control={
              <span className="text-sm">
                {data.delivery.lastSuccessAt
                  ? format.dateTime(data.delivery.lastSuccessAt)
                  : t("mail.delivery.never")}
              </span>
            }
          />
        </Section>
      ) : null}
    </SettingsPage>
  );
}
