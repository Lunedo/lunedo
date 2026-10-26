import { identityProviderNameSchema } from "@lunedo/shared";
import {
  Button,
  buttonClassName,
  ConfirmDialog,
  classNames,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  Section,
  Skeleton,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Check, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  type ConnectionCheckBody,
  type ConnectionCheckResult,
  certificateUrl,
  checkConnection,
  completeSetup,
  createDraft,
  createProvider,
  type DraftInput,
  type DraftUpdate,
  draftQuery,
  type IdentityProvider,
  identityKeys,
  type OidcConfigInput,
  type ProviderDraft,
  providerQuery,
  updateDraft,
} from "../../api/identity-queries.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { connectionCheckField, connectionCheckMessage, FailedCheckNotice } from "./connection-check.js";
import {
  AccountFields,
  AttributeFields,
  ConnectionFields,
  CopyField,
  LinkFields,
  RedirectUriField,
  SecondFactorFields,
  toConfigInput,
} from "./provider-config.js";
import {
  CertificateCreated,
  type CredentialDraft,
  CredentialFields,
  CredentialsList,
  credentialInput,
  emptyCredentialDraft,
} from "./provider-credentials.js";
import {
  CaCertificateSection,
  DirectoryTest,
  LdapAttributeFields,
  LdapConnectionFields,
  LdapSecondFactorFields,
} from "./provider-ldap.js";
import { SamlAttributeFields, SamlConnectionFields, SamlGraphClientField } from "./provider-saml.js";
import { StartTestButton, TestResult } from "./provider-test.js";
import {
  type CommonStepProps,
  type DirectoryDraft,
  DomainsField,
  emptyDirectoryDraft,
  emptySamlDraft,
  LdapConnectionStep,
  NameField,
  SamlConnectionStep,
  type SamlDraft,
  validateCommon,
  WizardFooter,
} from "./provider-wizard-steps.js";
import { providerPath } from "./providers-screen.js";

const instanceRoute = getRouteApi("/app/settings/instance/sign-in-providers/new");

type Step = "type" | "connection" | "attributes" | "directory" | "accounts" | "test";

function stepsFor(samlEntraId: boolean): Step[] {
  return samlEntraId
    ? ["type", "connection", "attributes", "directory", "accounts", "test"]
    : ["type", "connection", "attributes", "accounts", "test"];
}

type Choice = "entraId" | "google" | "oidc" | "saml" | "ldap";

const CHOICES: Choice[] = ["entraId", "google", "oidc", "saml", "ldap"];

interface WizardSearch {
  providerId?: string | undefined;
  draftId?: string | undefined;
  step?: number | undefined;
  providerTest?: string | undefined;
}

export function InstanceProviderWizardScreen() {
  const search = instanceRoute.useSearch();
  return <ProviderWizard search={search} />;
}

interface OidcDraft {
  clientId: string;
  tenantId: string;
  issuer: string;
  credential: CredentialDraft;
}

interface WizardDraft {
  choice: Choice;
  name: string;
  domains: string;
  oidc: OidcDraft;
  saml: SamlDraft;
  directory: DirectoryDraft;
}

const DEFAULT_NAMES: Record<Choice, string> = {
  entraId: "Microsoft",
  google: "Google",
  oidc: "",
  saml: "",
  ldap: "",
};

function emptyDraft(): WizardDraft {
  return {
    choice: "entraId",
    name: DEFAULT_NAMES.entraId,
    domains: "",
    oidc: { clientId: "", tenantId: "", issuer: "", credential: emptyCredentialDraft() },
    saml: emptySamlDraft(),
    directory: emptyDirectoryDraft(),
  };
}

function kindOf(draft: WizardDraft): { type: "oidc" | "saml" | "ldap"; preset: string } {
  if (draft.choice === "saml") return { type: "saml", preset: draft.saml.preset };
  if (draft.choice === "ldap") return { type: "ldap", preset: draft.directory.preset };
  return { type: "oidc", preset: OIDC_PRESETS[draft.choice] };
}

function choiceOf(type: ProviderDraft["type"], preset: ProviderDraft["preset"]): Choice {
  if (type === "saml") return "saml";
  if (type === "ldap") return "ldap";
  if (preset === "entraId") return "entraId";
  return preset === "google" ? "google" : "oidc";
}

function text(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : "";
}

function fieldsOf(draft: WizardDraft): Record<string, string | boolean> {
  if (draft.choice === "saml") {
    return {
      domains: draft.domains,
      tenantId: draft.saml.tenantId,
      source: draft.saml.source,
      url: draft.saml.url,
    };
  }
  if (draft.choice === "ldap") {
    return {
      domains: draft.domains,
      url: draft.directory.url,
      startTls: draft.directory.startTls,
      bindDn: draft.directory.bindDn,
      userBaseDn: draft.directory.userBaseDn,
      groupBaseDn: draft.directory.groupBaseDn,
    };
  }
  return {
    domains: draft.domains,
    clientId: draft.oidc.clientId,
    tenantId: draft.oidc.tenantId,
    issuer: draft.oidc.issuer,
  };
}

function restore(saved: ProviderDraft): WizardDraft {
  const fields = saved.fields;
  const empty = emptyDraft();
  const choice = choiceOf(saved.type, saved.preset);
  return {
    ...empty,
    choice,
    name: saved.name,
    domains: text(fields, "domains"),
    oidc: {
      ...empty.oidc,
      clientId: text(fields, "clientId"),
      tenantId: text(fields, "tenantId"),
      issuer: text(fields, "issuer"),
    },
    saml: {
      ...empty.saml,
      preset: saved.type === "saml" ? (saved.preset as SamlDraft["preset"]) : empty.saml.preset,
      tenantId: text(fields, "tenantId"),
      source: text(fields, "source") === "file" ? "file" : "url",
      url: text(fields, "url"),
    },
    directory: {
      ...empty.directory,
      preset: saved.type === "ldap" ? (saved.preset as DirectoryDraft["preset"]) : empty.directory.preset,
      url: text(fields, "url"),
      startTls: fields.startTls === true,
      bindDn: text(fields, "bindDn"),
      userBaseDn: text(fields, "userBaseDn"),
      groupBaseDn: text(fields, "groupBaseDn"),
    },
  };
}

const DRAFT_SAVE_DELAY_MS = 600;

function ProviderWizard({ search }: { search: WizardSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const state = useOrganizationState();
  const providerId = search.providerId;
  const draftId = providerId ? undefined : search.draftId;
  const provider = useQuery({
    ...providerQuery(providerId ?? ""),
    enabled: Boolean(providerId),
  });
  const saved = useQuery({ ...draftQuery(draftId ?? ""), enabled: Boolean(draftId) });
  const [draft, setDraft] = useState<WizardDraft>(emptyDraft);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishCheck, setFinishCheck] = useState<ConnectionCheckResult | null>(null);
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    if (!saved.data || restoredFrom === saved.data.id) return;
    const restored = restore(saved.data);
    lastSaved.current = JSON.stringify({
      name: restored.name,
      ...kindOf(restored),
      fields: fieldsOf(restored),
    });
    setDraft(restored);
    setRestoredFrom(saved.data.id);
  }, [saved.data, restoredFrom]);

  useEffect(() => {
    if (!draftId || restoredFrom !== draftId) return;
    const kind = kindOf(draft);
    const body = {
      ...(identityProviderNameSchema.safeParse(draft.name).success ? { name: draft.name.trim() } : {}),
      preset: kind.preset as DraftUpdate["preset"],
      fields: fieldsOf(draft),
    };
    const key = JSON.stringify({ name: draft.name, ...kind, fields: body.fields });
    if (key === lastSaved.current) return;
    const timer = setTimeout(() => {
      updateDraft(draftId, body)
        .then(() => {
          lastSaved.current = key;
          setDraftSaveFailed(false);
        })
        .catch(() => setDraftSaveFailed(true));
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, draftId, restoredFrom]);

  const connected = provider.data;
  const steps = stepsFor(
    connected
      ? connected.type === "saml" && connected.config.preset === "entraId"
      : draft.choice === "saml" && draft.saml.preset === "entraId",
  );
  const index = providerId ? Math.min(Math.max(search.step ?? 2, 1), steps.length - 1) : draftId ? 1 : 0;
  const step = steps[index] ?? "type";
  const canManage = state.can("instance.signIn.manage");
  const listPath = { to: "/settings/instance/sign-in-providers" as const };
  const goTo = (target: number) => {
    if (!providerId) return;
    void navigate({ to: ".", search: { providerId, step: target } } as never);
  };
  const created = (result: IdentityProvider) => {
    void queryClient.invalidateQueries({ queryKey: identityKeys.drafts });
    void navigate({ to: ".", search: { providerId: result.id, step: 2 } } as never);
  };
  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const kind = kindOf(draft);
      const name = identityProviderNameSchema.safeParse(draft.name).success
        ? draft.name.trim()
        : t(`identityProviders.wizard.choices.${draft.choice}.title`);
      const result = await createDraft({
        type: kind.type,
        preset: kind.preset as DraftInput["preset"],
        name,
      });
      await queryClient.invalidateQueries({ queryKey: identityKeys.drafts });
      void navigate({ to: ".", search: { draftId: result.id, step: 1 } } as never);
    } catch (failure) {
      setStartError(problemMessage(t, failure));
    } finally {
      setStarting(false);
    }
  };
  const finish = async (id: string, despiteCheck = false) => {
    setFinishError(null);
    try {
      if (!despiteCheck && provider.data) {
        const check = await checkConnection({
          type: provider.data.type,
          config: toConfigInput(provider.data),
          providerId: id,
        } as ConnectionCheckBody);
        if (!check.ok) {
          setFinishCheck(check);
          return;
        }
      }
      await completeSetup(id);
      await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
      void navigate(providerPath(id));
    } catch (failure) {
      setFinishError(problemMessage(t, failure));
    }
  };
  const common = {
    name: draft.name,
    domains: draft.domains,
    onCommonChange: (patch: { name?: string; domains?: string }) =>
      setDraft((current) => ({ ...current, ...patch })),
    canManage,
    draftId: draftId ?? "",
    onCreated: created,
  };

  return (
    <SettingsPage
      steps
      title={t("identityProviders.wizard.title")}
      back={{ label: t("identityProviders.title"), href: "/settings/instance/sign-in-providers" }}
      actions={
        <Button variant="secondary" onClick={() => void navigate(listPath)}>
          {providerId || draftId ? t("identityProviders.wizard.close") : t("common.cancel")}
        </Button>
      }
    >
      <div className="flex flex-col gap-6 md:flex-row">
        <nav aria-label={t("identityProviders.wizard.steps")} className="md:w-sidebar">
          <ol className="flex flex-col gap-1">
            {steps.map((name, position) => {
              const reachable = providerId ? position >= 1 : position === index;
              const marker = (
                <span className="flex size-icon-lg shrink-0 items-center justify-center rounded-full border border-control-border text-xs">
                  {position < index ? <Check aria-hidden="true" className="size-icon-sm" /> : position + 1}
                </span>
              );
              const stepName = t(`identityProviders.wizard.stepNames.${name}`);
              return (
                <li key={name}>
                  {reachable ? (
                    <button
                      type="button"
                      aria-current={position === index ? "step" : undefined}
                      onClick={() => goTo(position)}
                      className={classNames(
                        "flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left focus-visible:focus-ring",
                        position === index && "bg-selected font-semibold text-selected-text",
                      )}
                    >
                      {marker}
                      {stepName}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2 px-2 py-1 text-text-muted">
                      {marker}
                      <span className="flex flex-col">
                        <span>{stepName}</span>
                        <span className="text-xs">
                          {providerId && position === 0
                            ? t("identityProviders.wizard.typeFixed")
                            : t("identityProviders.wizard.stepLater")}
                        </span>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {!canManage ? <Notice variant="warning">{t("identityProviders.noPermission")}</Notice> : null}
          {step === "type" ? (
            <TypeStep
              value={draft.choice}
              busy={starting}
              error={startError}
              canManage={canManage}
              onChange={(choice) =>
                setDraft((current) => ({
                  ...current,
                  choice,
                  name: current.name === DEFAULT_NAMES[current.choice] ? DEFAULT_NAMES[choice] : current.name,
                }))
              }
              onContinue={() => void start()}
            />
          ) : null}
          {step === "connection" && draftId && !providerId ? (
            saved.isPending || restoredFrom !== draftId ? (
              saved.isError ? (
                <LoadError
                  what={t("failures.loadDraft")}
                  error={saved.error}
                  onRetry={() => saved.refetch()}
                />
              ) : (
                <Skeleton className="h-48 w-full" />
              )
            ) : (
              <>
                {saved.data ? <DraftCopyValues draft={saved.data} /> : null}
                {draftSaveFailed ? (
                  <Notice variant="warning">{t("identityProviders.wizard.draftNotSaved")}</Notice>
                ) : null}
                {draft.choice === "saml" ? (
                  <SamlConnectionStep
                    {...common}
                    draft={draft.saml}
                    onChange={(samlDraft) => setDraft((current) => ({ ...current, saml: samlDraft }))}
                  />
                ) : null}
                {draft.choice === "ldap" ? (
                  <LdapConnectionStep
                    {...common}
                    draft={draft.directory}
                    onChange={(directory) => setDraft((current) => ({ ...current, directory }))}
                  />
                ) : null}
                {draft.choice !== "saml" && draft.choice !== "ldap" ? (
                  <OidcConnectionStep
                    {...common}
                    choice={draft.choice}
                    draft={draft.oidc}
                    onChange={(oidc) => setDraft((current) => ({ ...current, oidc }))}
                  />
                ) : null}
              </>
            )
          ) : null}
          {providerId && step !== "type" ? (
            provider.isPending ? (
              <Skeleton className="h-48 w-full" />
            ) : provider.isError ? (
              <LoadError
                what={t("failures.loadProvider")}
                error={provider.error}
                onRetry={() => provider.refetch()}
              />
            ) : (
              <>
                {finishError ? (
                  <Notice variant="danger" title={t("failures.finishProviderSetup")}>
                    {finishError}
                  </Notice>
                ) : null}
                <ConfirmDialog
                  open={finishCheck !== null}
                  onOpenChange={(open) => {
                    if (!open) setFinishCheck(null);
                  }}
                  title={t("identityProviders.check.finishTitle")}
                  description={
                    finishCheck
                      ? t("identityProviders.check.finishDescription", {
                          check: t(`identityProviders.check.names.${finishCheck.check}`),
                          message: connectionCheckMessage(t, finishCheck),
                        })
                      : ""
                  }
                  confirmLabel={t("identityProviders.check.finishAnyway")}
                  cancelLabel={t("identityProviders.check.fixFirst")}
                  onConfirm={() => finish(provider.data.id, true)}
                />
                <SavedProviderStep
                  provider={provider.data}
                  step={step}
                  testStep={steps.indexOf("test")}
                  canManage={canManage}
                  flowId={search.providerTest}
                  isLast={index === steps.length - 1}
                  {...(index > 1 ? { onBack: () => goTo(index - 1) } : {})}
                  onContinue={() => goTo(index + 1)}
                  onConnection={() => goTo(steps.indexOf("connection"))}
                  onFinish={() => void finish(provider.data.id)}
                />
              </>
            )
          ) : null}
        </div>
      </div>
    </SettingsPage>
  );
}

function DraftCopyValues({ draft }: { draft: ProviderDraft }) {
  const { t } = useTranslation();
  if (draft.type === "ldap") return null;
  const kind =
    draft.type === "saml"
      ? draft.preset === "entraId"
        ? "samlEntraId"
        : draft.preset === "adfs"
          ? "adfs"
          : "saml"
      : choiceOf(draft.type, draft.preset);
  const place = translateKey(
    t,
    `identityProviders.wizard.places.${kind === "samlEntraId" ? "entraId" : kind}`,
  );
  return (
    <Section title={t("identityProviders.wizard.copyTitle", { place })}>
      <div className="flex flex-col gap-4 py-3">
        <p className="text-sm text-text-muted">
          {translateKey(t, `identityProviders.wizard.registerHints.${kind}`)}{" "}
          {t("identityProviders.wizard.copyHint", { place })}
        </p>
        {draft.saml ? (
          <>
            <CopyField
              label={t("identityProviders.saml.entityId")}
              value={draft.saml.entityId}
              hint={t("identityProviders.saml.entityIdHint")}
              help={t("identityProviders.saml.entityIdHelp")}
            />
            <CopyField
              label={t("identityProviders.saml.acsUrl")}
              value={draft.redirectUri}
              hint={t("identityProviders.saml.acsUrlHint")}
              help={t("identityProviders.saml.acsUrlHelp")}
            />
            <CopyField
              label={t("identityProviders.saml.metadataUrl")}
              value={draft.saml.metadataUrl}
              hint={t("identityProviders.saml.metadataUrlHint")}
              help={t("identityProviders.saml.metadataUrlHelp")}
              action={
                <a
                  href={draft.saml.metadataUrl}
                  download
                  className={buttonClassName({ variant: "secondary", className: "shrink-0" })}
                >
                  <Download aria-hidden="true" className="size-icon-sm" />
                  {t("identityProviders.saml.downloadMetadata")}
                </a>
              }
            />
            {draft.saml.signingCredentialId ? (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{t("identityProviders.wizard.signingCertificate")}</span>
                <span className="text-sm text-text-muted">
                  {t("identityProviders.wizard.signingCertificateHint", { place })}
                </span>
                <div>
                  <a
                    href={certificateUrl(draft.id, draft.saml.signingCredentialId)}
                    download
                    className={buttonClassName({ variant: "secondary" })}
                  >
                    <Download aria-hidden="true" className="size-icon-sm" />
                    {t("identityProviders.credentials.download")}
                  </a>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <RedirectUriField uri={draft.redirectUri} />
        )}
      </div>
    </Section>
  );
}

function TypeStep({
  value,
  busy,
  error,
  canManage,
  onChange,
  onContinue,
}: {
  value: Choice;
  busy: boolean;
  error: string | null;
  canManage: boolean;
  onChange: (choice: Choice) => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 font-semibold text-lg">{t("identityProviders.wizard.typeTitle")}</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              aria-pressed={value === choice}
              onClick={() => onChange(choice)}
              className={classNames(
                "flex flex-col items-start gap-1 rounded-md border p-4 text-left focus-visible:focus-ring",
                value === choice
                  ? "border-accent bg-selected"
                  : "border-control-border bg-surface hover:bg-hover",
              )}
            >
              <span className="font-semibold">{t(`identityProviders.wizard.choices.${choice}.title`)}</span>
              <span className="text-sm text-text-muted">
                {t(`identityProviders.wizard.choices.${choice}.hint`)}
              </span>
              <span className="text-sm text-text-muted">
                {t(`identityProviders.wizard.choices.${choice}.capabilities`)}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      {error ? (
        <Notice variant="danger" title={t("failures.startProviderDraft")}>
          {error}
        </Notice>
      ) : null}
      <p className="text-sm text-text-muted">{t("identityProviders.wizard.draftHint")}</p>
      <WizardFooter
        next={
          <Button variant="primary" loading={busy} disabled={!canManage} onClick={onContinue}>
            {t("common.continue")}
          </Button>
        }
      />
    </>
  );
}

const uuid = z.uuid();
const issuerSchema = z.url({ protocol: /^https?$/ });

const OIDC_PRESETS = { entraId: "entraId", google: "google", oidc: "generic" } as const;

function OidcConnectionStep({
  choice,
  draft,
  onChange,
  name,
  domains,
  onCommonChange,
  canManage,
  draftId,
  onCreated,
}: CommonStepProps & {
  choice: "entraId" | "google" | "oidc";
  draft: OidcDraft;
  onChange: (draft: OidcDraft) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [certificate, setCertificate] = useState<{ pem: string; provider: IdentityProvider } | null>(null);
  const [checkFailed, setCheckFailed] = useState(false);
  const preset = OIDC_PRESETS[choice];
  const set = (patch: Partial<OidcDraft>) => onChange({ ...draft, ...patch });

  const validate = (): OidcConfigInput | null => {
    const common = validateCommon(t, { name, domains });
    const found = common.errors;
    if (!draft.clientId.trim()) found.clientId = t("validation.required");
    if (preset === "entraId" && !uuid.safeParse(draft.tenantId.trim()).success) {
      found.tenantId = t("identityProviders.fields.tenantIdInvalid");
    }
    if (preset === "generic" && !issuerSchema.safeParse(draft.issuer.trim()).success) {
      found.issuer = t("validation.url");
    }
    if (preset === "google" && common.domains.length === 0 && !found.domains) {
      found.domains = t("identityProviders.fields.googleDomains");
    }
    const credential = credentialInput(draft.credential);
    if (!credential.ok) found[credential.field] = t("validation.required");
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalidSoon();
      return null;
    }
    const config = { clientId: draft.clientId.trim(), domains: common.domains };
    if (preset === "entraId") return { preset: "entraId", ...config, tenantId: draft.tenantId.trim() };
    if (preset === "google") return { preset: "google", ...config };
    return { preset: "generic", ...config, issuer: draft.issuer.trim() };
  };

  const create = async (despiteCheck = false) => {
    const config = validate();
    const credential = credentialInput(draft.credential);
    if (!config || !credential.ok) return;
    setBusy(true);
    setError(null);
    try {
      if (!despiteCheck) {
        const check = await checkConnection({ type: "oidc", config });
        if (!check.ok) {
          const field = connectionCheckField(check, preset === "entraId" ? "tenantId" : "issuer");
          setErrors((current) => ({ ...current, [field]: connectionCheckMessage(t, check) }));
          setCheckFailed(true);
          focusFirstInvalidSoon();
          return;
        }
      }
      setCheckFailed(false);
      const result = await createProvider({
        type: "oidc",
        name: name.trim(),
        draftId,
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
        <CertificateCreated pem={certificate.pem} name={certificate.provider.name} kind="certificate" />
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
        {t("identityProviders.wizard.connectionTitle", {
          type: t(`identityProviders.wizard.choices.${choice}.title`),
        })}
      </h2>
      {error ? (
        <Notice variant="danger" title={t("failures.createProvider")}>
          {error}
        </Notice>
      ) : null}
      <NameField
        kind={choice}
        value={name}
        error={errors.name}
        onChange={(next) => onCommonChange({ name: next })}
      />
      <div className="flex flex-col gap-4">
        {preset === "entraId" ? (
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
        {preset === "generic" ? (
          <Field
            label={t("identityProviders.fields.issuer")}
            hint={t("identityProviders.fields.issuerHint")}
            help={t("identityProviders.fields.issuerHelp")}
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
      {preset === "google" ? (
        <DomainsField
          value={domains}
          error={errors.domains}
          hint={t("identityProviders.accounts.domainsHintGoogle")}
          help={t("identityProviders.accounts.domainsHelpGoogle")}
          onChange={(next) => onCommonChange({ domains: next })}
        />
      ) : null}
      <Section title={t("identityProviders.credentials.title")}>
        <div className="py-3">
          <CredentialFields
            draft={draft.credential}
            onChange={(credential) => set({ credential })}
            invalid={errors.secret ? "secret" : errors.expiresOn ? "expiresOn" : null}
          />
        </div>
      </Section>
      {checkFailed ? <FailedCheckNotice busy={busy} onSaveAnyway={() => void create(true)} /> : null}
      <WizardFooter
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
  testStep,
  canManage,
  flowId,
  isLast,
  onBack,
  onContinue,
  onConnection,
  onFinish,
}: {
  provider: IdentityProvider;
  step: Step;
  testStep: number;
  canManage: boolean;
  flowId: string | undefined;
  isLast: boolean;
  onBack?: () => void;
  onContinue: () => void;
  onConnection: () => void;
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
      {step === "connection" ? (
        <>
          <h2 className="font-semibold text-lg">{t("identityProviders.wizard.stepNames.connection")}</h2>
          <Section title={t("identityProviders.settings.signIn")}>
            {provider.type === "oidc" ? <ConnectionFields provider={provider} canManage={canManage} /> : null}
            {provider.type === "saml" ? (
              <SamlConnectionFields provider={provider} canManage={canManage} />
            ) : null}
            {provider.type === "ldap" ? (
              <LdapConnectionFields provider={provider} canManage={canManage} />
            ) : null}
          </Section>
          {provider.type === "ldap" ? (
            <CaCertificateSection provider={provider} canManage={canManage} />
          ) : null}
        </>
      ) : null}
      {step === "attributes" ? (
        <>
          <Notice variant="success" title={t("identityProviders.wizard.saved", { name: provider.name })}>
            {t(`identityProviders.wizard.savedHints.${provider.type}`)}
          </Notice>
          <h2 className="font-semibold text-lg">{t("identityProviders.wizard.stepNames.attributes")}</h2>
          <p className="text-text-muted">{t("identityProviders.attributes.description")}</p>
          <Section title={t("identityProviders.attributes.mapping")}>
            {provider.type === "oidc" ? <AttributeFields provider={provider} canManage={canManage} /> : null}
            {provider.type === "saml" ? (
              <SamlAttributeFields provider={provider} canManage={canManage} />
            ) : null}
            {provider.type === "ldap" ? (
              <LdapAttributeFields
                provider={provider}
                canManage={canManage}
                onUploadCertificate={onConnection}
              />
            ) : null}
          </Section>
        </>
      ) : null}
      {step === "directory" && provider.type === "saml" ? (
        <>
          <h2 className="font-semibold text-lg">{t("identityProviders.wizard.stepNames.directory")}</h2>
          <Notice variant="info">{t("identityProviders.wizard.graphHint")}</Notice>
          {provider.warnings.includes("noGraphCredential") ? (
            <Notice
              variant="warning"
              title={t("identityProviders.warnings.noGraphTitle", { name: provider.name })}
            >
              {t("identityProviders.warnings.noGraph")}
            </Notice>
          ) : null}
          <Section title={t("identityProviders.wizard.graphApp")}>
            <SamlGraphClientField provider={provider} canManage={canManage} />
          </Section>
          <Section title={t("identityProviders.credentials.groupTitles.graph")}>
            <div className="py-3">
              <CredentialsList provider={provider} canManage={canManage} group="graph" />
            </div>
          </Section>
        </>
      ) : null}
      {step === "accounts" ? (
        <>
          <h2 className="font-semibold text-lg">{t("identityProviders.wizard.stepNames.accounts")}</h2>
          <Section title={t("identityProviders.accounts.newPeople")}>
            <AccountFields
              provider={provider}
              canManage={canManage}
              showDomains={provider.type === "oidc" && provider.config.preset !== "google"}
            />
          </Section>
          <Section title={t("identityProviders.accounts.existing")}>
            <LinkFields />
          </Section>
          <Section title={t("identityProviders.secondFactor.title")}>
            {provider.type === "ldap" ? (
              <LdapSecondFactorFields provider={provider} canManage={canManage} />
            ) : (
              <SecondFactorFields provider={provider} canManage={canManage} />
            )}
          </Section>
        </>
      ) : null}
      {step === "test" ? (
        <>
          <h2 className="font-semibold text-lg">{t("identityProviders.test.title")}</h2>
          {provider.type === "ldap" ? (
            <>
              <p className="text-text-muted">{t("identityProviders.directoryTest.description")}</p>
              <DirectoryTest provider={provider} />
            </>
          ) : (
            <>
              <p className="text-text-muted">{t("identityProviders.test.description")}</p>
              <StartTestButton
                provider={provider}
                variant="primary"
                returnTo={() => `${globalThis.location.pathname}?providerId=${provider.id}&step=${testStep}`}
              />
              {flowId ? <TestResult provider={provider} flowId={flowId} /> : null}
            </>
          )}
        </>
      ) : null}
      <WizardFooter {...(onBack ? { onBack } : {})} next={next} />
    </>
  );
}
