import {
  emailSchema,
  type Language,
  microsoftAuthorities,
  type SmtpConfigurationInput,
  type SmtpOAuth2Configuration,
  smtpConfigurationSchema,
  smtpOAuth2Providers,
  smtpPresetOf,
  smtpPresets,
  smtpSecurityModes,
} from "@lunedo/shared";
import {
  Button,
  CollapsibleSection,
  ErrorState,
  Field,
  FieldGrid,
  FieldGridItem,
  Input,
  Notice,
  PasswordInput,
  SegmentedControl,
  Select,
} from "@lunedo/ui";
import { Send } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { problemMessage } from "../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../forms/use-schema-form.js";
import { isLanguage } from "../i18n/index.js";
import { type MailFailureDetails, mailFailure } from "./mail-failure.js";
import { CLOUDS, OAuth2Steps, readServiceAccountKey } from "./smtp-oauth2.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SmtpInput extends SmtpConfigurationInput {
  password?: string | null;
  oauth2Secret?: string;
}

function sameClient(
  a: SmtpConfigurationInput["oauth2"] | undefined,
  b: SmtpOAuth2Configuration | null,
): boolean {
  if (!a || !b || a.provider !== b.provider) return false;
  if (a.provider === "microsoft365" && b.provider === "microsoft365") {
    return (
      a.tenantId === b.tenantId.toLowerCase() &&
      a.clientId === b.clientId.toLowerCase() &&
      (a.authority ?? microsoftAuthorities[0]) === b.authority
    );
  }
  if (a.provider === "google" && b.provider === "google") return a.serviceAccount === b.serviceAccount;
  if (a.provider === "generic" && b.provider === "generic") {
    return a.tokenUrl === b.tokenUrl && a.clientId === b.clientId;
  }
  return false;
}

function smtpFormSchema(initial: SmtpConfigurationInput | null, oauth2SecretSet: boolean) {
  return z
    .object({
      host: smtpConfigurationSchema.shape.host,
      port: z.coerce.number<string>().int().min(1).max(65_535),
      security: smtpConfigurationSchema.shape.security,
      authentication: z.enum(["password", "oauth2"]),
      username: z.string().max(256),
      password: z.string().max(1024),
      from: smtpConfigurationSchema.shape.from,
      provider: z.enum(smtpOAuth2Providers),
      tenantId: z.string(),
      clientId: z.string(),
      authority: z.enum(microsoftAuthorities),
      tokenUrl: z.string(),
      genericClientId: z.string(),
      scope: z.string(),
      clientSecret: z.string().max(20_000),
      keyFile: z.string(),
      serviceAccount: z.string(),
      googleClientId: z.string(),
    })
    .superRefine((values, context) => {
      const fail = (path: string) => context.addIssue({ code: "custom", path: [path], message: path });
      if (values.authentication === "password") {
        if (values.security === "none" && values.username !== "") fail("username");
        return;
      }
      if (values.security === "none") fail("security");
      if (values.username.trim() === "") fail("username");
      const oauth2 = oauth2Of(values);
      const keep = oauth2SecretSet && sameClient(initial?.oauth2 ?? null, oauth2);
      if (values.provider === "microsoft365") {
        if (!UUID.test(values.tenantId.trim())) fail("tenantId");
        if (!UUID.test(values.clientId.trim())) fail("clientId");
        if (values.clientSecret === "" && !keep) fail("clientSecret");
      }
      if (values.provider === "google") {
        if (values.keyFile === "invalid") fail("keyFile");
        else if (values.keyFile === "" && !keep) fail("keyFile");
      }
      if (values.provider === "generic") {
        if (!/^https:\/\/\S+$/.test(values.tokenUrl.trim())) fail("tokenUrl");
        if (values.genericClientId.trim() === "") fail("genericClientId");
        if (values.scope.trim() === "") fail("scope");
        if (values.clientSecret === "" && !keep) fail("clientSecret");
      }
    });
}

type SmtpFormSchema = ReturnType<typeof smtpFormSchema>;
type SmtpFormInput = z.input<SmtpFormSchema>;
type SmtpFormValues = z.output<SmtpFormSchema>;

function oauth2Of(values: SmtpFormValues): SmtpOAuth2Configuration | null {
  if (values.authentication !== "oauth2") return null;
  switch (values.provider) {
    case "microsoft365":
      return {
        provider: "microsoft365",
        tenantId: values.tenantId.trim().toLowerCase(),
        clientId: values.clientId.trim().toLowerCase(),
        authority: values.authority,
      };
    case "google":
      return { provider: "google", serviceAccount: values.serviceAccount, clientId: values.googleClientId };
    case "generic":
      return {
        provider: "generic",
        tokenUrl: values.tokenUrl.trim(),
        clientId: values.genericClientId.trim(),
        scope: values.scope.trim(),
      };
  }
}

function toInput(values: SmtpFormValues, passwordSet: boolean): SmtpInput {
  const username = values.username.trim() === "" ? null : values.username.trim();
  const oauth2 = oauth2Of(values);
  const base = {
    host: values.host,
    port: values.port,
    security: values.security,
    username,
    from: values.from,
  };
  if (oauth2) {
    const secret = oauth2.provider === "google" ? values.keyFile : values.clientSecret;
    return { ...base, oauth2, ...(secret === "" ? {} : { oauth2Secret: secret }) };
  }
  const password =
    username === null ? null : values.password !== "" ? values.password : passwordSet ? undefined : null;
  return { ...base, oauth2: null, ...(password === undefined ? {} : { password }) };
}

function defaults(initial: SmtpConfigurationInput | null): SmtpFormInput {
  const oauth2 = initial?.oauth2 ?? null;
  return {
    host: initial?.host ?? "",
    port: String(initial?.port ?? 587),
    security: initial?.security ?? "starttls",
    authentication: oauth2 ? "oauth2" : "password",
    username: initial?.username ?? "",
    password: "",
    from: initial?.from ?? "",
    provider: oauth2?.provider ?? "microsoft365",
    tenantId: oauth2?.provider === "microsoft365" ? oauth2.tenantId : "",
    clientId: oauth2?.provider === "microsoft365" ? oauth2.clientId : "",
    authority:
      oauth2?.provider === "microsoft365" && oauth2.authority ? oauth2.authority : microsoftAuthorities[0],
    tokenUrl: oauth2?.provider === "generic" ? oauth2.tokenUrl : "",
    genericClientId: oauth2?.provider === "generic" ? oauth2.clientId : "",
    scope: oauth2?.provider === "generic" ? oauth2.scope : "",
    clientSecret: "",
    keyFile: "",
    serviceAccount: oauth2?.provider === "google" ? oauth2.serviceAccount : "",
    googleClientId: oauth2?.provider === "google" ? oauth2.clientId : "",
  };
}

export interface SmtpFormProps {
  initial: SmtpConfigurationInput | null;
  passwordSet: boolean;
  oauth2SecretSet?: boolean;
  onSave: (input: SmtpInput) => Promise<void>;
  onTest: (input: SmtpInput & { to: string; language: Language }) => Promise<{
    delivered: boolean;
    error: MailFailureDetails | null;
  }>;
  defaultRecipient?: string;
  saveLabel: string;
  secondary?: ReactNode;
}

export function SmtpForm({
  initial,
  passwordSet,
  oauth2SecretSet = false,
  onSave,
  onTest,
  defaultRecipient,
  saveLabel,
  secondary,
}: SmtpFormProps) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [testResult, setTestResult] = useState<{
    delivered: boolean;
    cause: string;
    details: string | null;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [preset, setPreset] = useState(smtpPresetOf(initial) ?? "custom");
  const [schema] = useState(() => smtpFormSchema(initial, oauth2SecretSet));
  const form = useSchemaForm(schema, {
    defaultValues: defaults(initial),
    messages: {
      username: t("mail.credentialsNeedTls"),
      security: t("mail.oauth2.errors.tls"),
      tenantId: t("mail.oauth2.errors.tenantId"),
      clientId: t("mail.oauth2.errors.clientId"),
      clientSecret: t("mail.oauth2.errors.clientSecret"),
      keyFile: t("mail.oauth2.errors.keyFile"),
      tokenUrl: t("mail.oauth2.errors.tokenUrl"),
      genericClientId: t("mail.oauth2.errors.genericClientId"),
      scope: t("mail.oauth2.errors.scope"),
    },
  });
  const authentication = form.watch("authentication");
  const provider = form.watch("provider");
  const oauth2 = authentication === "oauth2";
  const keyFile = form.watch("keyFile");
  const serviceAccount = form.watch("serviceAccount");
  const googleClientId = form.watch("googleClientId");
  const usernameError = form.formState.errors.username
    ? oauth2
      ? t("mail.oauth2.errors.mailbox")
      : t("mail.credentialsNeedTls")
    : undefined;
  const fieldError = (name: keyof SmtpFormInput) => {
    const message = form.formState.errors[name]?.message;
    return message ? { error: message } : {};
  };

  const save = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await onSave(toInput(values, passwordSet));
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
    }
  });

  const test = form.handleSubmit(async (values) => {
    setTestResult(null);
    if (!emailSchema.safeParse(recipient).success) {
      setTestResult({ delivered: false, cause: t("validation.email"), details: null });
      return;
    }
    setTesting(true);
    try {
      const result = await onTest({
        ...toInput(values, passwordSet),
        to: recipient,
        language: isLanguage(i18n.language) ? i18n.language : "en",
      });
      setTestResult({
        delivered: result.delivered,
        ...mailFailure(t, result.error, { oauth2: values.authentication === "oauth2" }),
      });
    } catch (failure) {
      setTestResult({ delivered: false, cause: problemMessage(t, failure), details: null });
    } finally {
      setTesting(false);
    }
  });

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(save)}>
      {error ? (
        <Notice variant="danger" title={t("failures.saveMail")}>
          {error}
        </Notice>
      ) : null}
      <Field label={t("mail.preset")} hint={t("mail.presetHint")}>
        <Select
          aria-label={t("mail.preset")}
          value={preset}
          onValueChange={(value) => {
            setPreset(value);
            const chosen = smtpPresets.find((entry) => entry.id === value);
            if (!chosen) return;
            form.setValue("host", chosen.host, { shouldDirty: true });
            form.setValue("port", String(chosen.port), { shouldDirty: true });
            form.setValue("security", chosen.security, { shouldDirty: true });
            if (chosen.oauth2) {
              form.setValue("authentication", "oauth2", { shouldDirty: true });
              form.setValue("provider", chosen.oauth2, { shouldDirty: true });
            }
          }}
          options={[
            { value: "custom", label: t("mail.presetCustom") },
            ...smtpPresets.map((entry) => ({ value: entry.id, label: entry.name })),
          ]}
        />
      </Field>
      <FieldGrid columns={3}>
        <FieldGridItem span={2}>
          <Field label={t("mail.host")} {...fieldError("host")}>
            <Input autoComplete="off" {...form.register("host")} />
          </Field>
        </FieldGridItem>
        <Field label={t("mail.port")} {...fieldError("port")}>
          <Input inputMode="numeric" autoComplete="off" {...form.register("port")} />
        </Field>
      </FieldGrid>
      <Field label={t("mail.security")} hint={t("mail.securityHint")} {...fieldError("security")}>
        <Controller
          control={form.control}
          name="security"
          render={({ field }) => (
            <SegmentedControl
              label={t("mail.security")}
              value={field.value}
              onValueChange={field.onChange}
              options={smtpSecurityModes.map((mode) => ({
                value: mode,
                label: t(`mail.securityModes.${mode}`),
              }))}
            />
          )}
        />
      </Field>
      <Field label={t("mail.authentication")} hint={t("mail.authenticationHint")}>
        <Controller
          control={form.control}
          name="authentication"
          render={({ field }) => (
            <SegmentedControl
              label={t("mail.authentication")}
              value={field.value}
              onValueChange={field.onChange}
              options={(["password", "oauth2"] as const).map((mode) => ({
                value: mode,
                label: t(`mail.authenticationModes.${mode}`),
              }))}
            />
          )}
        />
      </Field>
      {oauth2 ? (
        <>
          <Field label={t("mail.oauth2.provider")}>
            <Controller
              control={form.control}
              name="provider"
              render={({ field }) => (
                <Select
                  aria-label={t("mail.oauth2.provider")}
                  value={field.value}
                  onValueChange={field.onChange}
                  options={smtpOAuth2Providers.map((value) => ({
                    value,
                    label: t(`mail.oauth2.providers.${value}`),
                  }))}
                />
              )}
            />
          </Field>
          <OAuth2Steps
            provider={provider}
            mailbox={form.watch("username")}
            clientId={form.watch("clientId")}
          />
          <Field
            label={t("mail.mailbox")}
            hint={t("mail.mailboxHint")}
            {...(usernameError ? { error: usernameError } : {})}
          >
            <Input type="email" autoComplete="off" {...form.register("username")} />
          </Field>
          {provider === "microsoft365" ? (
            <>
              <FieldGrid>
                <Field label={t("mail.oauth2.tenantId")} {...fieldError("tenantId")}>
                  <Input className="font-mono" autoComplete="off" {...form.register("tenantId")} />
                </Field>
                <Field label={t("mail.oauth2.clientId")} {...fieldError("clientId")}>
                  <Input className="font-mono" autoComplete="off" {...form.register("clientId")} />
                </Field>
              </FieldGrid>
              <CollapsibleSection
                title={t("mail.oauth2.advanced")}
                level={3}
                layout="fields"
                defaultOpen={form.getValues("authority") !== microsoftAuthorities[0]}
              >
                <Field label={t("mail.oauth2.cloud")}>
                  <Controller
                    control={form.control}
                    name="authority"
                    render={({ field }) => (
                      <Select
                        aria-label={t("mail.oauth2.cloud")}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={microsoftAuthorities.map((authority) => ({
                          value: authority,
                          label: t(`mail.oauth2.clouds.${CLOUDS[authority]}`),
                        }))}
                      />
                    )}
                  />
                </Field>
              </CollapsibleSection>
            </>
          ) : null}
          {provider === "generic" ? (
            <>
              <Field label={t("mail.oauth2.tokenUrl")} {...fieldError("tokenUrl")}>
                <Input type="url" autoComplete="off" {...form.register("tokenUrl")} />
              </Field>
              <FieldGrid>
                <Field label={t("mail.oauth2.genericClientId")} {...fieldError("genericClientId")}>
                  <Input autoComplete="off" {...form.register("genericClientId")} />
                </Field>
                <Field label={t("mail.oauth2.scope")} {...fieldError("scope")}>
                  <Input autoComplete="off" {...form.register("scope")} />
                </Field>
              </FieldGrid>
            </>
          ) : null}
          {provider === "google" ? (
            <Field
              label={t("mail.oauth2.keyFile")}
              hint={
                oauth2SecretSet && keyFile === "" ? t("mail.oauth2.keyKept") : t("mail.oauth2.keyFileHint")
              }
              {...(form.formState.errors.keyFile
                ? {
                    error:
                      keyFile === "invalid"
                        ? t("mail.oauth2.errors.keyFileInvalid")
                        : t("mail.oauth2.errors.keyFile"),
                  }
                : {})}
            >
              <div className="flex flex-col gap-2">
                <Controller
                  control={form.control}
                  name="keyFile"
                  render={({ field }) => (
                    <Input
                      ref={field.ref}
                      type="file"
                      accept="application/json,.json"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        void file.text().then((text) => {
                          const key = readServiceAccountKey(text);
                          field.onChange(key ? text : "invalid");
                          form.setValue("serviceAccount", key?.clientEmail ?? "");
                          form.setValue("googleClientId", key?.clientId ?? "");
                        });
                      }}
                    />
                  )}
                />
                {serviceAccount ? (
                  <span className="text-sm text-text-muted wrap-anywhere">
                    {t("mail.oauth2.serviceAccount", { email: serviceAccount, clientId: googleClientId })}
                  </span>
                ) : null}
              </div>
            </Field>
          ) : (
            <Field
              label={t("mail.oauth2.clientSecret")}
              hint={oauth2SecretSet ? t("mail.oauth2.secretKept") : undefined}
              {...fieldError("clientSecret")}
            >
              <PasswordInput autoComplete="new-password" {...form.register("clientSecret")} />
            </Field>
          )}
        </>
      ) : (
        <FieldGrid>
          <Field
            label={t("mail.username")}
            hint={t("mail.usernameHint")}
            {...(usernameError ? { error: usernameError } : {})}
          >
            <Input autoComplete="off" {...form.register("username")} />
          </Field>
          <Field
            label={t("mail.password")}
            hint={passwordSet ? t("mail.passwordKept") : undefined}
            {...fieldError("password")}
          >
            <PasswordInput autoComplete="new-password" {...form.register("password")} />
          </Field>
        </FieldGrid>
      )}
      <Field label={t("mail.from")} {...fieldError("from")}>
        <Input type="email" autoComplete="off" {...form.register("from")} />
      </Field>
      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <Field label={t("mail.testRecipient")}>
          <Input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" icon={Send} loading={testing} onClick={() => void test()}>
            {t("mail.sendTest")}
          </Button>
        </div>
        {testResult?.delivered ? (
          <div role="status" className="flex flex-col gap-1">
            <span className="text-success">{t("mail.testDelivered")}</span>
            <span className="text-sm text-text-muted">{t("mail.testDeliveryFollows")}</span>
          </div>
        ) : null}
        {testResult && !testResult.delivered ? (
          <ErrorState
            title={t("mail.testFailed")}
            cause={testResult.cause}
            action={t("mail.testFailedAction")}
            details={testResult.details}
            onRetry={() => void test()}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        {secondary ?? <span />}
        <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
          {saveLabel}
        </Button>
      </div>
    </form>
  );
}
