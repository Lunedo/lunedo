import { accountNameSchema, passwordSchema } from "@pagehall/shared";
import { Button, Field, Input, Notice, PasswordInput, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Circle } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { instanceInfoQuery } from "../../api/queries.js";
import { isApiError, request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { translateKey } from "../../i18n/translate.js";
import { forgetLinkToken, useLinkToken } from "../../session/link-token.js";
import { AuthCard } from "./auth-layout.js";

const DEFAULT_PASSWORD_MINIMUM = 12;

function detailsForm(minimum: number) {
  return z
    .object({ name: accountNameSchema, password: passwordSchema.min(minimum), repeated: z.string() })
    .refine((values) => values.password === values.repeated, { path: ["repeated"], message: "mismatch" });
}

type State = "start" | "details" | "joined" | "created";

export function AcceptInvitationScreen() {
  const { t } = useTranslation();
  const token = useLinkToken();
  const info = useQuery(instanceInfoQuery);
  const [state, setState] = useState<State>("start");
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minimum = info.data?.passwordMinLength ?? DEFAULT_PASSWORD_MINIMUM;
  const schema = useMemo(() => detailsForm(minimum), [minimum]);
  const form = useSchemaForm(schema, {
    defaultValues: { name: "", password: "", repeated: "" },
    messages: { repeated: t("auth.passwordsDiffer") },
  });
  const longEnough = [...(form.watch("password") ?? "")].length >= minimum;

  const preview = useQuery({
    queryKey: ["invitationPreview", token],
    queryFn: () =>
      request(() => api.POST("/api/v1/invitations/preview", { body: { token: token ?? "" } }), {
        sessionHandling: false,
      }),
    enabled: token !== null,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    throwOnError: false,
  });

  if (!token || isApiError(preview.error, "invalidToken")) {
    return <Unavailable message={token ? t("auth.invitationInvalid") : t("auth.invitationMissing")} />;
  }
  if (preview.isPending) {
    return (
      <AuthCard title={t("auth.invitationTitle")}>
        <Skeleton className="h-10 w-full" />
      </AuthCard>
    );
  }
  if (preview.isError) {
    return (
      <AuthCard title={t("auth.invitationTitle")}>
        <LoadError
          what={t("failures.loadInvitation")}
          error={preview.error}
          onRetry={() => preview.refetch()}
        />
      </AuthCard>
    );
  }
  const invitation = preview.data;
  const names = {
    organization: invitation.organizationName,
    inviter: invitation.invitedByName ?? "",
    email: invitation.email,
    knowledgeBase: invitation.knowledgeBaseName ?? "",
  };
  const portal = Boolean(invitation.knowledgeBaseName);
  const step = state === "start" && invitation.newAccount ? "details" : state;
  if (invitation.state !== "open" && state === "start") {
    const unknown = invitation.invitedByName === null ? "Unknown" : "";
    const message =
      invitation.state === "accepted"
        ? t("auth.invitationAccepted", names)
        : invitation.state === "expired"
          ? translateKey(t, `auth.invitationExpired${unknown}`, names)
          : translateKey(t, `auth.invitationRevoked${unknown}`, names);
    return <Unavailable message={message} accepted={invitation.state === "accepted"} />;
  }

  const accept = async (details: { name?: string; password?: string } = {}) => {
    setError(null);
    setBusy(true);
    try {
      const result = await request(
        () => api.POST("/api/v1/invitations/accept", { body: { token, ...details } }),
        { sessionHandling: false },
      );
      forgetLinkToken();
      setPortalUrl(result.portalUrl);
      setState(result.accountCreated ? "created" : "joined");
    } catch (failure) {
      if (isApiError(failure, "accountDetailsRequired")) setState("details");
      else setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={portal ? t("auth.portalInvitationFor", names) : t("auth.invitationFor", names)}
      description={
        portal
          ? t("auth.portalInvitationDescription", names)
          : invitation.invitedByName === null
            ? t("auth.invitationFromUnknown", names)
            : t("auth.invitationFrom", names)
      }
    >
      {error ? (
        <Notice variant="danger" title={t("failures.acceptInvitation")}>
          {error}
        </Notice>
      ) : null}
      {step === "start" ? (
        <Button variant="primary" size="lg" block loading={busy} onClick={() => void accept()}>
          {t("auth.acceptInvitation")}
        </Button>
      ) : null}
      {step === "details" ? (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={submitWith(
            form.handleSubmit((values) => accept({ name: values.name, password: values.password })),
          )}
        >
          <Notice variant="info">{t("auth.createAccountForInvitation")}</Notice>
          <Field label={t("auth.name")} error={form.formState.errors.name?.message}>
            <Input autoComplete="name" autoFocus {...form.register("name")} />
          </Field>
          <Field
            label={t("auth.password")}
            hint={
              <span className={`inline-flex items-center gap-1 ${longEnough ? "text-success" : ""}`}>
                {longEnough ? (
                  <Check aria-hidden="true" className="size-icon-sm shrink-0" />
                ) : (
                  <Circle aria-hidden="true" className="size-icon-sm shrink-0" />
                )}
                {t("auth.passwordHint", { minimum })}
                <span className="sr-only">
                  {longEnough ? t("auth.passwordRuleMet") : t("auth.passwordRuleOpen")}
                </span>
              </span>
            }
            error={form.formState.errors.password?.message}
          >
            <PasswordInput autoComplete="new-password" {...form.register("password")} />
          </Field>
          <Field label={t("auth.repeatPassword")} error={form.formState.errors.repeated?.message}>
            <PasswordInput autoComplete="new-password" {...form.register("repeated")} />
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {t("auth.createAccount")}
          </Button>
        </form>
      ) : null}
      {state === "joined" || state === "created" ? (
        <>
          <Notice variant="success">
            {portalUrl
              ? t("auth.portalAccountCreated", names)
              : state === "created"
                ? t("auth.invitationAccountCreated")
                : t("auth.invitationJoined")}
          </Notice>
          {portalUrl ? (
            <Button variant="primary" block asChild>
              <a href={portalUrl}>{t("auth.openPortal", names)}</a>
            </Button>
          ) : (
            <Button variant="primary" block asChild>
              <Link to="/sign-in">{t("auth.signIn")}</Link>
            </Button>
          )}
        </>
      ) : null}
    </AuthCard>
  );
}

function Unavailable({ message, accepted = false }: { message: string; accepted?: boolean }) {
  const { t } = useTranslation();
  return (
    <AuthCard title={t("auth.invitationTitle")}>
      <Notice
        variant={accepted ? "info" : "warning"}
        title={accepted ? undefined : t("auth.invitationUnavailableTitle")}
      >
        {message}
      </Notice>
      <Button variant={accepted ? "primary" : "secondary"} block asChild>
        <Link to="/sign-in">{t("auth.signIn")}</Link>
      </Button>
    </AuthCard>
  );
}
