import { Button, Notice, Spinner } from "@pagehall/ui";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useLinkToken } from "../../session/link-token.js";
import { AuthCard } from "./auth-layout.js";

export function ConfirmEmailScreen() {
  const { t } = useTranslation();
  const token = useLinkToken();
  const confirm = useMutation({
    mutationFn: (value: string) =>
      request(() => api.POST("/api/v1/auth/email-change/confirm", { body: { token: value } }), {
        sessionHandling: false,
      }),
  });
  const { mutate } = confirm;
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    mutate(token);
  }, [token, mutate]);

  return (
    <AuthCard title={t("auth.confirmEmailTitle")}>
      {!token ? <Notice variant="danger">{t("problems.invalidToken")}</Notice> : null}
      {confirm.isPending ? <Spinner label={t("auth.confirmingEmail")} /> : null}
      {confirm.isSuccess ? <Notice variant="success">{t("auth.emailConfirmed")}</Notice> : null}
      {confirm.isError ? <Notice variant="danger">{problemMessage(t, confirm.error)}</Notice> : null}
      <Button variant="primary" block asChild>
        <Link to="/">{t("auth.continue")}</Link>
      </Button>
    </AuthCard>
  );
}
