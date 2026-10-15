import { Button, Notice, Spinner } from "@pagehall/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { MailX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { FailureNotice, LoadError } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { AuthCard } from "../screens/auth/auth-layout.js";

interface UnsubscribeState {
  scope: "event" | "digest";
  event: string | null;
  off: boolean;
}

export function UnsubscribeScreen() {
  const { t } = useTranslation();
  const { token } = useParams({ from: "/public/unsubscribe/$token" });
  const state = useQuery({
    queryKey: ["unsubscribe", token],
    queryFn: () =>
      request(() => api.GET("/api/v1/notifications/unsubscribe/{token}", { params: { path: { token } } }), {
        sessionHandling: false,
      }),
    retry: false,
    throwOnError: false,
  });
  const turnOff = useMutation({
    mutationFn: () =>
      request(
        () =>
          api.POST("/api/v1/notifications/unsubscribe/{token}", { params: { path: { token } }, body: {} }),
        {
          sessionHandling: false,
        },
      ),
  });
  const current: UnsubscribeState | undefined = turnOff.data ?? state.data;
  const event = current?.event ? translateKey(t, `notifications.events.${current.event}`) : "";

  return (
    <AuthCard title={t("notifications.unsubscribe.title")}>
      {state.isPending ? <Spinner label={t("notifications.unsubscribe.loading")} /> : null}
      {state.isError ? (
        <LoadError what={t("failures.unsubscribeLink")} error={state.error} onRetry={() => state.refetch()} />
      ) : null}
      {current && !current.off ? (
        <>
          <p>
            {current.scope === "digest"
              ? t("notifications.unsubscribe.digest")
              : t("notifications.unsubscribe.event", { event })}
          </p>
          {turnOff.isError ? (
            <FailureNotice
              what={t("notifications.unsubscribe.failed")}
              error={turnOff.error}
              onRetry={() => turnOff.mutate()}
            />
          ) : null}
          <Button
            variant="primary"
            block
            icon={MailX}
            loading={turnOff.isPending}
            onClick={() => turnOff.mutate()}
          >
            {t("notifications.unsubscribe.confirm")}
          </Button>
        </>
      ) : null}
      {current?.off ? (
        <Notice variant="success">
          {current.scope === "digest"
            ? t("notifications.unsubscribe.digestOff")
            : t("notifications.unsubscribe.eventOff", { event })}
        </Notice>
      ) : null}
      <Button variant="secondary" block asChild>
        <Link to="/settings/notifications">{t("notifications.unsubscribe.settings")}</Link>
      </Button>
    </AuthCard>
  );
}
