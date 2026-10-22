import { recoveryCodeSchema, totpCodeSchema } from "@lunedo/shared";
import { Button, Field, Input, Notice } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Fingerprint } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { queryKeys } from "../../api/queries.js";
import { isApiError, request } from "../../api/request.js";
import { CodeInput } from "../../components/code-input.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { getPasskeyAssertion, isPasskeyCancelled, passkeysSupported } from "../../session/passkeys.js";
import { leavesApp, safeRedirect } from "../../session/redirect.js";
import { AuthCard } from "./auth-layout.js";

type Factor = "totp" | "passkey" | "recoveryCode";

const route = getRouteApi("/public/sign-in/verify");

const totpForm = z.object({ code: totpCodeSchema.min(1) });
const recoveryForm = z.object({ code: recoveryCodeSchema.min(1) });

export function SecondFactorScreen() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const available = search.factors.filter((factor) => factor !== "passkey" || passkeysSupported());
  const [factor, setFactor] = useState<Factor>(available[0] ?? "totp");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const totp = useSchemaForm(totpForm, { defaultValues: { code: "" } });
  const recovery = useSchemaForm(recoveryForm, { defaultValues: { code: "" } });

  const complete = async (body: { type: "totp"; code: string } | { type: "recoveryCode"; code: string }) => {
    setError(null);
    setBusy(true);
    try {
      await request(() => api.POST("/api/v1/auth/sign-in/second-factor", { body }), {
        sessionHandling: false,
      });
      await finish();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    const target = safeRedirect(search.redirect);
    await navigate({ href: target, reloadDocument: leavesApp(target) });
  };

  const fail = (failure: unknown) => {
    if (isApiError(failure, "challengeExpired")) setExpired(true);
    setError(isPasskeyCancelled(failure) ? t("auth.passkeyCancelled") : problemMessage(t, failure));
  };

  const verifyWithPasskey = async () => {
    setError(null);
    setBusy(true);
    try {
      const options = await request(() => api.POST("/api/v1/auth/sign-in/second-factor/passkey-options"), {
        sessionHandling: false,
      });
      const response = await getPasskeyAssertion(options);
      await request(
        () =>
          api.POST("/api/v1/auth/sign-in/second-factor", {
            body: { type: "passkey", response: response as never },
          }),
        { sessionHandling: false },
      );
      await finish();
    } catch (failure) {
      fail(failure);
    } finally {
      setBusy(false);
    }
  };

  const alternatives = available.filter((candidate) => candidate !== factor);

  return (
    <AuthCard title={t("auth.verifyTitle")} description={t("auth.verifyDescription")}>
      {error ? (
        <Notice variant="danger" title={t("failures.verifySecondFactor")}>
          {error}
        </Notice>
      ) : null}
      {expired ? (
        <Button variant="primary" block asChild>
          <Link to="/sign-in" search={search.redirect ? { redirect: search.redirect } : {}}>
            {t("auth.startOver")}
          </Link>
        </Button>
      ) : null}
      {!expired && factor === "totp" ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={submitWith(
            totp.handleSubmit((values) => complete({ type: "totp", code: values.code.replace(/\s/g, "") })),
          )}
        >
          <Field
            label={t("auth.authenticatorCode")}
            hint={t("auth.authenticatorCodeHint")}
            error={totp.formState.errors.code?.message}
          >
            <CodeInput control={totp.control} name="code" autoFocus />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {t("auth.verify")}
          </Button>
        </form>
      ) : null}
      {!expired && factor === "passkey" ? (
        <div className="flex flex-col gap-4">
          <Notice variant="info">{t("auth.passkeyHint")}</Notice>
          <Button
            variant="primary"
            size="lg"
            block
            icon={Fingerprint}
            loading={busy}
            onClick={() => void verifyWithPasskey()}
          >
            {t("auth.usePasskey")}
          </Button>
        </div>
      ) : null}
      {!expired && factor === "recoveryCode" ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={submitWith(
            recovery.handleSubmit((values) => complete({ type: "recoveryCode", code: values.code })),
          )}
        >
          <Field
            label={t("auth.recoveryCode")}
            hint={t("auth.recoveryCodeHint")}
            error={recovery.formState.errors.code?.message}
          >
            <Input autoComplete="off" autoFocus className="font-mono" {...recovery.register("code")} />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {t("auth.verify")}
          </Button>
        </form>
      ) : null}
      {!expired && alternatives.length > 0 ? (
        <p className="flex flex-wrap justify-center gap-x-2 text-sm">
          {alternatives.map((alternative, index) => (
            <Fragment key={alternative}>
              {index > 0 ? (
                <span aria-hidden="true" className="text-text-muted">
                  ·
                </span>
              ) : null}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => {
                  setFactor(alternative);
                  setError(null);
                }}
              >
                {t(`auth.useFactor.${alternative}`)}
              </button>
            </Fragment>
          ))}
        </p>
      ) : null}
      <Link
        to="/sign-in"
        search={search.redirect ? { redirect: search.redirect } : {}}
        className="inline-flex items-center gap-1 self-center text-sm text-text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden="true" className="size-icon-sm" />
        {t("auth.backToSignIn")}
      </Link>
    </AuthCard>
  );
}
