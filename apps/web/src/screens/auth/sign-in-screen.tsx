import { passwordSchema, signInEmailSchema } from "@lunedo/shared";
import { Button, Dialog, Field, Input, Notice, PasswordInput, Skeleton } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Fingerprint, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { type DiscoveredStep, discoverSignIn, signInOptionsQuery } from "../../api/identity-queries.js";
import { instanceInfoQuery, queryKeys } from "../../api/queries.js";
import { isApiError, request } from "../../api/request.js";
import { ProviderButton } from "../../components/provider-button.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { translateKey } from "../../i18n/translate.js";
import { getPasskeyAssertion, isPasskeyCancelled, passkeysSupported } from "../../session/passkeys.js";
import { startProviderSignIn } from "../../session/provider-sign-in.js";
import { leavesApp, safeRedirect } from "../../session/redirect.js";
import { AUTH_LINK, AuthCard, OrDivider } from "./auth-layout.js";
import { DirectorySignInForm, type DirectoryTarget, secondFactors } from "./directory-sign-in.js";

const route = getRouteApi("/public/sign-in");

const emailForm = z.object({ email: signInEmailSchema });
const passwordForm = z.object({ password: passwordSchema });
const emergencyForm = z.object({ email: signInEmailSchema, password: passwordSchema });

const PROVIDER_ERRORS = new Set([
  "challengeExpired",
  "invalidCredentials",
  "providerUnavailable",
  "providerInitiatedSignIn",
]);

export function providerErrorMessage(t: (key: string) => string, code: string): string {
  return PROVIDER_ERRORS.has(code) ? t(`problems.${code}`) : t("auth.providers.failed");
}

type Step = { email: string; next: DiscoveredStep };

export function orderedProviders<T extends { id: string }>(
  providers: readonly T[],
  lastId: string | null,
): T[] {
  const last = providers.find((provider) => provider.id === lastId);
  return last ? [last, ...providers.filter((provider) => provider !== last)] : [...providers];
}

export function SignInScreen() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const info = useQuery(instanceInfoQuery);
  const options = useQuery(signInOptionsQuery);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [providerBusy, setProviderBusy] = useState<string | null>(null);
  const [shortcut, setShortcut] = useState<DirectoryTarget | null>(null);
  const emailStep = useSchemaForm(emailForm, { defaultValues: { email: "" } });
  const passwordStep = useSchemaForm(passwordForm, { defaultValues: { password: "" } });
  const data = options.data;

  const signedIn = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
    await queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
    const target = safeRedirect(search.redirect);
    await navigate({ href: target, reloadDocument: leavesApp(target) });
  };

  const signInWithPassword = async (email: string, password: string) => {
    const result = await request(() => api.POST("/api/v1/auth/sign-in", { body: { email, password } }), {
      sessionHandling: false,
    });
    if (result.status === "secondFactorRequired") {
      await navigate({
        to: "/sign-in/verify",
        search: {
          factors: secondFactors(result.factors),
          ...(search.redirect ? { redirect: search.redirect } : {}),
        },
      });
      return;
    }
    await signedIn();
  };

  const discover = emailStep.handleSubmit(async ({ email }) => {
    setError(null);
    try {
      setStep({ email, next: await discoverSignIn(email) });
    } catch (failure) {
      setError(problemMessage(t, failure));
    }
  });

  const submitPassword = passwordStep.handleSubmit(async ({ password }) => {
    if (!step) return;
    setError(null);
    try {
      await signInWithPassword(step.email, password);
    } catch (failure) {
      if (isApiError(failure, "invalidCredentials")) {
        passwordStep.resetField("password");
        passwordStep.setError(
          "password",
          { type: "server", message: t("auth.wrongPassword") },
          { shouldFocus: true },
        );
        return;
      }
      setError(problemMessage(t, failure));
      passwordStep.resetField("password");
    }
  });

  const signInWithProvider = async (providerId: string) => {
    setError(null);
    setProviderBusy(providerId);
    try {
      await startProviderSignIn(providerId, {
        returnTo: search.redirect ? safeRedirect(search.redirect) : null,
      });
    } catch (failure) {
      setError(problemMessage(t, failure));
      setProviderBusy(null);
    }
  };

  const signInWithPasskey = async () => {
    setError(null);
    setPasskeyBusy(true);
    try {
      const passkeyOptions = await request(() => api.POST("/api/v1/auth/sign-in/passkey-options"), {
        sessionHandling: false,
      });
      const response = await getPasskeyAssertion(passkeyOptions);
      await request(
        () => api.POST("/api/v1/auth/sign-in/passkey", { body: { response: response as never } }),
        { sessionHandling: false },
      );
      await signedIn();
    } catch (failure) {
      setError(isPasskeyCancelled(failure) ? t("auth.passkeyCancelled") : problemMessage(t, failure));
    } finally {
      setPasskeyBusy(false);
    }
  };

  const setEmergency = (open: boolean) => {
    void navigate({
      to: "/sign-in",
      search: { ...search, emergency: open ? true : undefined },
      replace: true,
    });
  };

  const changeEmail = () => {
    setStep(null);
    setShortcut(null);
    setError(null);
    passwordStep.reset();
  };

  const passkeyButton = passkeysSupported() ? (
    <Button
      variant="outline"
      size="lg"
      block
      icon={Fingerprint}
      loading={passkeyBusy}
      onClick={() => void signInWithPasskey()}
    >
      {t("auth.signInWithPasskey")}
    </Button>
  ) : null;

  const identity = step ? (
    <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
      <UserRound aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-text">{step.email}</span>
        {step.next.step === "provider" || step.next.step === "directory" ? (
          <span className="text-sm text-text-muted">
            {t("auth.discover.domainUses", { domain: step.email.split("@")[1] ?? "", name: step.next.name })}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="font-medium text-accent text-sm hover:underline focus-visible:focus-ring"
        onClick={changeEmail}
      >
        {t("auth.discover.change")}
      </button>
    </div>
  ) : null;

  return (
    <AuthCard
      title={t("auth.signInHeading")}
      description={t("auth.signInLead")}
      links={
        <>
          {(!step || step.next.step === "password") && !shortcut ? (
            <Link to="/reset-password" className={AUTH_LINK}>
              {t("auth.forgotPassword")}
            </Link>
          ) : null}
          {info.data?.selfRegistration ? (
            <Link to="/register" className={AUTH_LINK}>
              {t("auth.registerLink")}
            </Link>
          ) : null}
        </>
      }
    >
      {search.reason === "sessionEnded" ? <Notice variant="info">{t("auth.sessionEnded")}</Notice> : null}
      {search.error ? (
        <Notice variant="danger" title={t("auth.providers.failedTitle")}>
          {providerErrorMessage((key) => translateKey(t, key), search.error)}
        </Notice>
      ) : null}
      {error ? (
        <Notice variant="danger" title={t("auth.signInFailed")}>
          {error}
        </Notice>
      ) : null}
      {options.isPending ? <Skeleton className="h-10 w-full" /> : null}
      {options.isError ? (
        <LoadError
          what={t("failures.loadSignInOptions")}
          error={options.error}
          onRetry={() => options.refetch()}
        />
      ) : null}
      {shortcut && !step ? (
        <>
          <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
            <UserRound aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate font-medium text-text">{shortcut.name}</span>
            <button
              type="button"
              className="font-medium text-accent text-sm hover:underline focus-visible:focus-ring"
              onClick={changeEmail}
            >
              {t("auth.discover.change")}
            </button>
          </div>
          <DirectorySignInForm target={shortcut} redirect={search.redirect} onSignedIn={signedIn} />
        </>
      ) : null}
      {data && !step && !shortcut ? (
        <>
          {data.providers.length > 0 ? (
            <>
              <div className="flex flex-col gap-2">
                {orderedProviders(data.providers, data.lastProvider?.id ?? null).map((provider) => (
                  <ProviderButton
                    key={provider.id}
                    provider={provider}
                    busy={providerBusy === provider.id}
                    onClick={() => {
                      if (provider.type === "ldap") {
                        setError(null);
                        setShortcut({
                          providerId: provider.id,
                          name: provider.name,
                          signInName: null,
                          email: null,
                        });
                        return;
                      }
                      void signInWithProvider(provider.id);
                    }}
                  />
                ))}
              </div>
              <OrDivider label={t("auth.discover.or")} />
            </>
          ) : null}
          <form className="flex flex-col gap-4" onSubmit={submitWith(discover)} noValidate>
            <Field label={t("auth.workEmail")} error={emailStep.formState.errors.email?.message}>
              <Input
                type="email"
                autoComplete="username webauthn"
                autoFocus
                {...emailStep.register("email")}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                block
                loading={emailStep.formState.isSubmitting}
              >
                {t("auth.continue")}
              </Button>
              {passkeyButton}
            </div>
          </form>
        </>
      ) : null}
      {step?.next.step === "provider" ? (
        <>
          {identity}
          <ProviderButton
            provider={{
              id: step.next.providerId,
              name: step.next.name,
              preset: step.next.preset,
              logoRef: null,
            }}
            busy={providerBusy === step.next.providerId}
            onClick={() => void signInWithProvider(step.next.step === "provider" ? step.next.providerId : "")}
          />
        </>
      ) : null}
      {step?.next.step === "directory" ? (
        <>
          {identity}
          <DirectorySignInForm
            target={{
              providerId: step.next.providerId,
              name: step.next.name,
              signInName: step.next.signInName,
              email: step.email,
            }}
            redirect={search.redirect}
            onSignedIn={signedIn}
          />
        </>
      ) : null}
      {step?.next.step === "password" ? (
        <>
          {identity}
          <form className="flex flex-col gap-4" onSubmit={submitWith(submitPassword)} noValidate>
            <Field label={t("auth.password")} error={passwordStep.formState.errors.password?.message}>
              <PasswordInput
                autoComplete="current-password"
                autoFocus
                {...passwordStep.register("password")}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={passwordStep.formState.isSubmitting}
            >
              {t("auth.signIn")}
            </Button>
          </form>
        </>
      ) : null}
      <EmergencyDialog
        open={search.emergency === true}
        onOpenChange={setEmergency}
        signIn={async (values) => {
          await signInWithPassword(values.email, values.password);
        }}
      />
    </AuthCard>
  );
}

function EmergencyDialog({
  open,
  onOpenChange,
  signIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signIn: (values: { email: string; password: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(emergencyForm, { defaultValues: { email: "", password: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await signIn(values);
    } catch (failure) {
      setError(problemMessage(t, failure));
      form.resetField("password");
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("auth.emergency.title")} size="sm">
      <form className="flex flex-col gap-4" onSubmit={submitWith(submit)} noValidate>
        <p className="text-text-muted">{t("auth.emergency.description")}</p>
        {error ? (
          <Notice variant="danger" title={t("auth.signInFailed")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("auth.email")} error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="username" {...form.register("email")} />
        </Field>
        <Field label={t("auth.password")} error={form.formState.errors.password?.message}>
          <PasswordInput autoComplete="current-password" {...form.register("password")} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("auth.emergency.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
