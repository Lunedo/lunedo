import { domainSchema, identityProviderNameSchema } from "@pagehall/shared";
import { Button, classNames, Field, Input, Notice, Section, Skeleton } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, KeyRound } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  createProvider,
  type IdentityProvider,
  identityKeys,
  type ProviderConfigInput,
  type ProviderPreset,
  providerQuery,
} from "../../api/identity-queries.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import {
  AccountFields,
  AttributeFields,
  LinkFields,
  parseList,
  RedirectUriField,
} from "./provider-config.js";
import {
  type CredentialDraft,
  CredentialFields,
  credentialInput,
  downloadCertificate,
  emptyCredentialDraft,
} from "./provider-credentials.js";
import { presetLabel } from "./provider-labels.js";
import { StartTestButton, TestResult } from "./provider-test.js";
import { providerPath } from "./providers-screen.js";

const instanceRoute = getRouteApi("/app/settings/instance/sign-in-providers/new");

type Step = "type" | "connection" | "attributes" | "accounts" | "test";

const STEPS: Step[] = ["type", "connection", "attributes", "accounts", "test"];

interface WizardSearch {
  providerId?: string | undefined;
  step?: number | undefined;
  providerTest?: string | undefined;
}

export function InstanceProviderWizardScreen() {
  const search = instanceRoute.useSearch();
  return <ProviderWizard search={search} />;
}

interface ConnectionDraft {
  preset: ProviderPreset;
  name: string;
  clientId: string;
  tenantId: string;
  issuer: string;
  domains: string;
  credential: CredentialDraft;
}

const DEFAULT_NAMES: Record<ProviderPreset, string> = { entraId: "Microsoft", google: "Google", generic: "" };

function ProviderWizard({ search }: { search: WizardSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useOrganizationState();
  const steps = STEPS;
  const providerId = search.providerId;
  const provider = useQuery({
    ...providerQuery(providerId ?? ""),
    enabled: Boolean(providerId),
  });
  const [localStep, setLocalStep] = useState(0);
  const index = providerId
    ? Math.min(Math.max(search.step ?? 2, 2), steps.length - 1)
    : Math.min(localStep, 1);
  const step = steps[index] ?? "type";
  const [draft, setDraft] = useState<ConnectionDraft>({
    preset: "entraId",
    name: DEFAULT_NAMES.entraId,
    clientId: "",
    tenantId: "",
    issuer: "",
    domains: "",
    credential: emptyCredentialDraft(),
  });
  const canManage = state.can("instance.signIn.manage");
  const listPath = { to: "/settings/instance/sign-in-providers" as const };
  const goTo = (target: number) => {
    if (!providerId) {
      setLocalStep(target);
      return;
    }
    void navigate({ to: ".", search: { providerId, step: target } } as never);
  };

  return (
    <SettingsPage
      width="wide"
      title={t("identityProviders.wizard.title")}
      icon={KeyRound}
      breadcrumbs={[
        { label: t("identityProviders.title"), href: "/settings/instance/sign-in-providers" },
        { label: t("identityProviders.wizard.new") },
      ]}
      actions={
        <Button variant="secondary" onClick={() => void navigate(listPath)}>
          {providerId ? t("identityProviders.wizard.close") : t("common.cancel")}
        </Button>
      }
    >
      <div className="flex flex-col gap-6 md:flex-row">
        <nav aria-label={t("identityProviders.wizard.steps")} className="md:w-sidebar">
          <ol className="flex flex-col gap-1">
            {steps.map((name, position) => {
              const reachable = providerId
                ? position >= 2
                : position <= Math.max(localStep, 0) && position <= 1;
              return (
                <li key={name}>
                  <button
                    type="button"
                    disabled={!reachable}
                    aria-current={position === index ? "step" : undefined}
                    onClick={() => goTo(position)}
                    className={classNames(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left focus-visible:focus-ring disabled:cursor-not-allowed disabled:text-text-muted",
                      position === index && "bg-selected font-semibold text-selected-text",
                    )}
                  >
                    <span className="flex size-icon-lg shrink-0 items-center justify-center rounded-full border border-control-border text-xs">
                      {position < index ? (
                        <Check aria-hidden="true" className="size-icon-sm" />
                      ) : (
                        position + 1
                      )}
                    </span>
                    {t(`identityProviders.wizard.stepNames.${name}`)}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {!canManage ? <Notice variant="warning">{t("identityProviders.noPermission")}</Notice> : null}
          {step === "type" ? (
            <TypeStep
              value={draft.preset}
              onChange={(preset) =>
                setDraft((current) => ({
                  ...current,
                  preset,
                  name: current.name === DEFAULT_NAMES[current.preset] ? DEFAULT_NAMES[preset] : current.name,
                }))
              }
              onContinue={() => goTo(1)}
            />
          ) : null}
          {step === "connection" ? (
            <ConnectionStep
              draft={draft}
              onChange={setDraft}
              canManage={canManage}
              onBack={() => goTo(0)}
              onCreated={(created) =>
                void navigate({ to: ".", search: { providerId: created.id, step: 2 } } as never)
              }
            />
          ) : null}
          {providerId && step !== "type" && step !== "connection" ? (
            provider.isPending ? (
              <Skeleton className="h-48 w-full" />
            ) : provider.isError ? (
              <LoadError
                what={t("failures.loadProvider")}
                error={provider.error}
                onRetry={() => provider.refetch()}
              />
            ) : (
              <SavedProviderStep
                provider={provider.data}
                step={step}
                canManage={canManage}
                flowId={search.providerTest}
                isLast={index === steps.length - 1}
                onBack={() => goTo(index - 1)}
                onContinue={() => goTo(index + 1)}
                onFinish={() => void navigate(providerPath(provider.data.id))}
              />
            )
          ) : null}
        </div>
      </div>
    </SettingsPage>
  );
}

function WizardFooter({ onBack, next }: { onBack?: () => void; next: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-between gap-2 border-border border-t pt-4">
      {onBack ? (
        <Button variant="secondary" icon={ArrowLeft} onClick={onBack}>
          {t("common.back")}
        </Button>
      ) : (
        <span />
      )}
      {next}
    </div>
  );
}

function TypeStep({
  value,
  onChange,
  onContinue,
}: {
  value: ProviderPreset;
  onChange: (preset: ProviderPreset) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const presets: ProviderPreset[] = ["entraId", "google", "generic"];
  return (
    <>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold text-lg">{t("identityProviders.wizard.typeTitle")}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={value === preset}
              onClick={() => onChange(preset)}
              className={classNames(
                "flex flex-col items-start gap-1 rounded-md border p-4 text-left focus-visible:focus-ring",
                value === preset
                  ? "border-accent bg-selected"
                  : "border-control-border bg-surface hover:bg-hover",
              )}
            >
              <span className="font-semibold">{presetLabel(t, preset)}</span>
              <span className="text-sm text-text-muted">
                {t(`identityProviders.wizard.typeHints.${preset}`)}
              </span>
              <span className="text-sm text-text-muted">
                {t(`identityProviders.wizard.capabilities.${preset}`)}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <p className="text-sm text-text-muted">{t("identityProviders.wizard.typeMore")}</p>
      <WizardFooter
        next={
          <Button variant="primary" onClick={onContinue}>
            {t("common.continue")}
          </Button>
        }
      />
    </>
  );
}

const uuid = z.uuid();
const issuerSchema = z.url({ protocol: /^https?$/ });

function ConnectionStep({
  draft,
  onChange,
  canManage,
  onBack,
  onCreated,
}: {
  draft: ConnectionDraft;
  onChange: (draft: ConnectionDraft) => void;
  canManage: boolean;
  onBack: () => void;
  onCreated: (provider: IdentityProvider) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [certificate, setCertificate] = useState<{ pem: string; provider: IdentityProvider } | null>(null);
  const set = (patch: Partial<ConnectionDraft>) => onChange({ ...draft, ...patch });

  const validate = (): ProviderConfigInput | null => {
    const found: Record<string, string> = {};
    if (!identityProviderNameSchema.safeParse(draft.name).success) found.name = t("validation.required");
    if (!draft.clientId.trim()) found.clientId = t("validation.required");
    if (draft.preset === "entraId" && !uuid.safeParse(draft.tenantId.trim()).success) {
      found.tenantId = t("identityProviders.fields.tenantIdInvalid");
    }
    if (draft.preset === "generic" && !issuerSchema.safeParse(draft.issuer.trim()).success) {
      found.issuer = t("validation.url");
    }
    const domains = parseList(draft.domains);
    if (domains.some((domain) => !domainSchema.safeParse(domain).success)) {
      found.domains = t("identityProviders.accounts.domainsInvalid");
    }
    if (draft.preset === "google" && domains.length === 0)
      found.domains = t("identityProviders.fields.googleDomains");
    const credential = credentialInput(draft.credential);
    if (!credential.ok) found[credential.field] = t("validation.required");
    setErrors(found);
    if (Object.keys(found).length > 0) return null;
    const common = { clientId: draft.clientId.trim(), domains };
    if (draft.preset === "entraId") return { preset: "entraId", ...common, tenantId: draft.tenantId.trim() };
    if (draft.preset === "google") return { preset: "google", ...common };
    return { preset: "generic", ...common, issuer: draft.issuer.trim() };
  };

  const create = async () => {
    const config = validate();
    const credential = credentialInput(draft.credential);
    if (!config || !credential.ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createProvider({
        name: draft.name.trim(),
        config,
        credential: credential.value,
      });
      await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
      if (result.credential?.certificate) {
        setCertificate({ pem: result.credential.certificate, provider: result.provider });
        return;
      }
      onCreated(result.provider);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  if (certificate) {
    return (
      <>
        <Notice variant="success" title={t("identityProviders.credentials.certificateCreated")}>
          {t("identityProviders.credentials.certificateUpload")}
        </Notice>
        <div>
          <Button
            variant="secondary"
            onClick={() => downloadCertificate(certificate.pem, certificate.provider.name)}
          >
            {t("identityProviders.credentials.download")}
          </Button>
        </div>
        <WizardFooter
          next={
            <Button variant="primary" onClick={() => onCreated(certificate.provider)}>
              {t("common.continue")}
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <h2 className="font-semibold text-lg">
        {t("identityProviders.wizard.connectionTitle", { type: presetLabel(t, draft.preset) })}
      </h2>
      <Notice variant="info">{t(`identityProviders.wizard.connectionHints.${draft.preset}`)}</Notice>
      {error ? (
        <Notice variant="danger" title={t("failures.createProvider")}>
          {error}
        </Notice>
      ) : null}
      <Field
        label={t("identityProviders.fields.name")}
        hint={t("identityProviders.fields.nameHint")}
        {...(errors.name ? { error: errors.name } : {})}
      >
        <Input value={draft.name} onChange={(event) => set({ name: event.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {draft.preset === "entraId" ? (
          <Field
            label={t("identityProviders.fields.tenantId")}
            hint={t("identityProviders.fields.tenantIdHint")}
            {...(errors.tenantId ? { error: errors.tenantId } : {})}
          >
            <Input
              className="font-mono"
              value={draft.tenantId}
              onChange={(event) => set({ tenantId: event.target.value })}
            />
          </Field>
        ) : null}
        {draft.preset === "generic" ? (
          <Field
            label={t("identityProviders.fields.issuer")}
            hint={t("identityProviders.fields.issuerHint")}
            {...(errors.issuer ? { error: errors.issuer } : {})}
          >
            <Input
              type="url"
              className="font-mono"
              value={draft.issuer}
              onChange={(event) => set({ issuer: event.target.value })}
            />
          </Field>
        ) : null}
        <Field
          label={t("identityProviders.fields.clientId")}
          {...(errors.clientId ? { error: errors.clientId } : {})}
        >
          <Input
            className="font-mono"
            value={draft.clientId}
            onChange={(event) => set({ clientId: event.target.value })}
          />
        </Field>
      </div>
      {draft.preset === "google" ? (
        <Field
          label={t("identityProviders.accounts.domains")}
          hint={t("identityProviders.accounts.domainsHintGoogle")}
          {...(errors.domains ? { error: errors.domains } : {})}
        >
          <Input value={draft.domains} onChange={(event) => set({ domains: event.target.value })} />
        </Field>
      ) : null}
      <Section title={t("identityProviders.credentials.title")}>
        <div className="px-4 py-3">
          <CredentialFields
            draft={draft.credential}
            onChange={(credential) => set({ credential })}
            invalid={errors.secret ? "secret" : errors.expiresOn ? "expiresOn" : null}
          />
        </div>
      </Section>
      <WizardFooter
        onBack={onBack}
        next={
          <Button variant="primary" loading={busy} disabled={!canManage} onClick={() => void create()}>
            {t("identityProviders.wizard.saveConnection")}
          </Button>
        }
      />
    </>
  );
}

function SavedProviderStep({
  provider,
  step,
  canManage,
  flowId,
  isLast,
  onBack,
  onContinue,
  onFinish,
}: {
  provider: IdentityProvider;
  step: Step;
  canManage: boolean;
  flowId: string | undefined;
  isLast: boolean;
  onBack: () => void;
  onContinue: () => void;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const next = (
    <Button variant="primary" onClick={isLast ? onFinish : onContinue}>
      {isLast ? t("identityProviders.wizard.finish") : t("common.continue")}
    </Button>
  );
  return (
    <>
      {step === "attributes" ? (
        <>
          <Notice variant="success" title={t("identityProviders.wizard.saved", { name: provider.name })}>
            {t("identityProviders.wizard.redirectHint")}
          </Notice>
          <RedirectUriField uri={provider.redirectUri} />
          <h2 className="font-semibold text-lg">{t("identityProviders.wizard.stepNames.attributes")}</h2>
          <p className="text-text-muted">{t("identityProviders.attributes.description")}</p>
          <Section title={t("identityProviders.attributes.mapping")}>
            <AttributeFields provider={provider} canManage={canManage} />
          </Section>
        </>
      ) : null}
      {step === "accounts" ? (
        <>
          <h2 className="font-semibold text-lg">{t("identityProviders.wizard.stepNames.accounts")}</h2>
          <Section title={t("identityProviders.accounts.newPeople")}>
            <AccountFields provider={provider} canManage={canManage} />
          </Section>
          <Section title={t("identityProviders.accounts.existing")}>
            <LinkFields />
          </Section>
        </>
      ) : null}
      {step === "test" ? (
        <>
          <h2 className="font-semibold text-lg">{t("identityProviders.test.title")}</h2>
          <p className="text-text-muted">{t("identityProviders.test.description")}</p>
          <StartTestButton
            provider={provider}
            variant="primary"
            returnTo={() =>
              `${globalThis.location.pathname}?providerId=${provider.id}&step=${STEPS.indexOf("test")}`
            }
          />
          {flowId ? <TestResult provider={provider} flowId={flowId} /> : null}
        </>
      ) : null}
      <WizardFooter onBack={onBack} next={next} />
    </>
  );
}
