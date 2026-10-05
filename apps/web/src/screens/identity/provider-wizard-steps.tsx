import {
  directoryPasswordSchema,
  distinguishedNameSchema,
  domainSchema,
  identityProviderNameSchema,
  ldapServerAddress,
} from "@pagehall/shared";
import {
  Button,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  PasswordInput,
  SegmentedControl,
  Switch,
} from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { ArrowLeft, FileUp } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  checkConnection,
  createProvider,
  type IdentityProvider,
  identityKeys,
  type LdapConfigInput,
  type SamlConfigInput,
  setCaCertificate,
} from "../../api/identity-queries.js";
import { problemMessage } from "../../errors/problem-message.js";
import { connectionCheckField, connectionCheckMessage, FailedCheckNotice } from "./connection-check.js";
import { FileButton, readFileText } from "./file-button.js";
import { domainsHintKey, parseList } from "./provider-config.js";
import { presetLabel } from "./provider-labels.js";
import { CERTIFICATE_TYPES, isPlainLdap, ldapUrlSchema, serviceAccountField } from "./provider-ldap.js";
import { METADATA_TYPES, metadataUrlSchema } from "./provider-saml.js";

export function WizardFooter({ onBack, next }: { onBack?: () => void; next: ReactNode }) {
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

export interface CommonStepProps {
  name: string;
  domains: string;
  onCommonChange: (patch: { name?: string; domains?: string }) => void;
  canManage: boolean;
  draftId: string;
  onCreated: (provider: IdentityProvider) => void;
}

export function validateCommon(
  t: TFunction,
  values: { name: string; domains: string },
): { errors: Record<string, string>; domains: string[] } {
  const errors: Record<string, string> = {};
  if (!identityProviderNameSchema.safeParse(values.name).success) errors.name = t("validation.required");
  const domains = parseList(values.domains);
  if (domains.some((domain) => !domainSchema.safeParse(domain).success)) {
    errors.domains = t("identityProviders.accounts.domainsInvalid");
  }
  return { errors, domains };
}

export function NameField({
  kind,
  value,
  error,
  onChange,
}: {
  kind: "entraId" | "google" | "oidc" | "saml" | "ldap";
  value: string;
  error: string | undefined;
  onChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field
      label={t("identityProviders.fields.name")}
      hint={t(`identityProviders.fields.nameHints.${kind}`)}
      {...(error ? { error } : {})}
    >
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

export function DomainsField({
  value,
  error,
  hint,
  onChange,
}: {
  value: string;
  error: string | undefined;
  hint: string;
  onChange: (domains: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field label={t("identityProviders.accounts.domains")} hint={hint} {...(error ? { error } : {})}>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </Field>
  );
}

function ChosenFile({
  label,
  accept,
  file,
  error,
  hint,
  onFile,
}: {
  label: string;
  accept: string;
  file: { name: string } | null;
  error: string | undefined;
  hint: string;
  onFile: (file: File) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <FileButton label={label} accept={accept} icon={FileUp} variant="secondary" onFile={onFile} />
        <span className="min-w-0 break-all text-sm text-text-muted">
          {file ? file.name : t("identityProviders.wizard.noFile")}
        </span>
      </div>
      <span className="text-sm text-text-muted">{hint}</span>
      {error ? (
        <span role="alert" className="text-danger text-sm">
          {error}
        </span>
      ) : null}
    </div>
  );
}

const SAML_PRESETS = ["entraId", "adfs", "generic"] as const;

export interface SamlDraft {
  preset: (typeof SAML_PRESETS)[number];
  tenantId: string;
  source: "url" | "file";
  url: string;
  file: { name: string; xml: string } | null;
}

export function emptySamlDraft(): SamlDraft {
  return { preset: "entraId", tenantId: "", source: "url", url: "", file: null };
}

const uuid = z.uuid();

export function SamlConnectionStep({
  draft,
  onChange,
  name,
  domains,
  onCommonChange,
  canManage,
  draftId,
  onCreated,
}: CommonStepProps & { draft: SamlDraft; onChange: (draft: SamlDraft) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const set = (patch: Partial<SamlDraft>) => onChange({ ...draft, ...patch });

  const validate = (): SamlConfigInput | null => {
    const common = validateCommon(t, { name, domains });
    const found = common.errors;
    if (draft.preset === "entraId" && !uuid.safeParse(draft.tenantId.trim()).success) {
      found.tenantId = t("identityProviders.fields.tenantIdInvalid");
    }
    if (draft.source === "url" && !metadataUrlSchema.safeParse(draft.url.trim()).success) {
      found.url = t("validation.url");
    }
    if (draft.source === "file" && !draft.file)
      found.file = t("identityProviders.wizard.metadataFileRequired");
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalidSoon();
      return null;
    }
    const shared = {
      domains: common.domains,
      metadata:
        draft.source === "url"
          ? { source: "url" as const, url: draft.url.trim() }
          : { source: "file" as const },
    };
    if (draft.preset === "entraId") return { preset: "entraId", ...shared, tenantId: draft.tenantId.trim() };
    if (draft.preset === "adfs") return { preset: "adfs", ...shared };
    return { preset: "generic", ...shared };
  };

  const create = async (despiteCheck = false) => {
    const config = validate();
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      if (!despiteCheck && config.metadata.source === "url") {
        const check = await checkConnection({ type: "saml", config });
        if (!check.ok) {
          setErrors((current) => ({ ...current, url: connectionCheckMessage(t, check) }));
          setCheckFailed(true);
          focusFirstInvalidSoon();
          return;
        }
      }
      setCheckFailed(false);
      const result = await createProvider({
        type: "saml",
        name: name.trim(),
        draftId,
        config,
        ...(draft.source === "file" && draft.file ? { metadataXml: draft.file.xml } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
      onCreated(result.provider);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = async (file: File) => {
    try {
      set({ file: { name: file.name, xml: await readFileText(file) } });
      setErrors(({ file: _file, ...rest }) => rest);
    } catch {
      setErrors((current) => ({ ...current, file: t("identityProviders.wizard.fileUnreadable") }));
    }
  };

  return (
    <>
      <h2 className="font-semibold text-lg">{t("identityProviders.wizard.samlTitle")}</h2>
      <SegmentedControl
        label={t("identityProviders.wizard.samlPreset")}
        value={draft.preset}
        onValueChange={(preset) => set({ preset: preset as SamlDraft["preset"] })}
        options={SAML_PRESETS.map((preset) => ({ value: preset, label: presetLabel(t, "saml", preset) }))}
      />
      {error ? (
        <Notice variant="danger" title={t("failures.createProvider")}>
          {error}
        </Notice>
      ) : null}
      <NameField
        kind="saml"
        value={name}
        error={errors.name}
        onChange={(next) => onCommonChange({ name: next })}
      />
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
      <div className="flex flex-col gap-3">
        <SegmentedControl
          label={t("identityProviders.saml.source")}
          value={draft.source}
          onValueChange={(source) => set({ source: source as SamlDraft["source"] })}
          options={(["url", "file"] as const).map((source) => ({
            value: source,
            label: t(`identityProviders.saml.sources.${source}`),
          }))}
        />
        {draft.source === "url" ? (
          <Field
            label={t("identityProviders.saml.metadataAddress")}
            hint={t(`identityProviders.wizard.metadataUrlHints.${draft.preset}`)}
            {...(errors.url ? { error: errors.url } : {})}
          >
            <Input
              type="url"
              className="font-mono"
              value={draft.url}
              onChange={(event) => set({ url: event.target.value })}
            />
          </Field>
        ) : (
          <ChosenFile
            label={t("identityProviders.wizard.chooseMetadata")}
            accept={METADATA_TYPES}
            file={draft.file}
            error={errors.file}
            hint={t("identityProviders.wizard.metadataFileHint")}
            onFile={(file) => void chooseFile(file)}
          />
        )}
      </div>
      <DomainsField
        value={domains}
        error={errors.domains}
        hint={t(domainsHintKey("saml", draft.preset))}
        onChange={(next) => onCommonChange({ domains: next })}
      />
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

const LDAP_PRESETS = ["activeDirectory", "generic"] as const;

export interface DirectoryDraft {
  preset: (typeof LDAP_PRESETS)[number];
  url: string;
  startTls: boolean;
  bindDn: string;
  password: string;
  userBaseDn: string;
  groupBaseDn: string;
  ca: { name: string; pem: string } | null;
}

export function emptyDirectoryDraft(): DirectoryDraft {
  return {
    preset: "activeDirectory",
    url: "",
    startTls: false,
    bindDn: "",
    password: "",
    userBaseDn: "",
    groupBaseDn: "",
    ca: null,
  };
}

const DN_FIELDS = ["userBaseDn", "groupBaseDn"] as const;

export function LdapConnectionStep({
  draft,
  onChange,
  name,
  domains,
  onCommonChange,
  canManage,
  draftId,
  onCreated,
}: CommonStepProps & { draft: DirectoryDraft; onChange: (draft: DirectoryDraft) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [caFailure, setCaFailure] = useState<{ provider: IdentityProvider; message: string } | null>(null);
  const set = (patch: Partial<DirectoryDraft>) => onChange({ ...draft, ...patch });
  const plain = isPlainLdap(draft.url);
  const serviceAccount = serviceAccountField(draft.preset);

  const validate = (): LdapConfigInput | null => {
    const common = validateCommon(t, { name, domains });
    const found = common.errors;
    if (!ldapUrlSchema.safeParse(draft.url.trim()).success)
      found.url = t("identityProviders.ldap.urlInvalid");
    if (!serviceAccount.schema.safeParse(draft.bindDn).success) found.bindDn = t(serviceAccount.invalid);
    for (const field of DN_FIELDS) {
      if (!distinguishedNameSchema.safeParse(draft[field]).success) {
        found[field] = t("identityProviders.ldap.dnInvalid");
      }
    }
    if (!directoryPasswordSchema.safeParse(draft.password).success) found.password = t("validation.required");
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalidSoon();
      return null;
    }
    const shared = {
      url: ldapServerAddress(draft.url) ?? draft.url.trim(),
      startTls: plain && draft.startTls,
      bindDn: draft.bindDn.trim(),
      userBaseDn: draft.userBaseDn.trim(),
      groupBaseDn: draft.groupBaseDn.trim(),
      domains: common.domains,
    };
    return draft.preset === "activeDirectory"
      ? { preset: "activeDirectory", ...shared }
      : { preset: "generic", ...shared };
  };

  const create = async (despiteCheck = false) => {
    const config = validate();
    if (!config) return;
    setBusy(true);
    setError(null);
    try {
      if (!despiteCheck) {
        const check = await checkConnection({
          type: "ldap",
          config,
          bindPassword: draft.password,
          ...(draft.ca ? { caCertificate: draft.ca.pem } : {}),
        });
        if (!check.ok) {
          setErrors((current) => ({
            ...current,
            [connectionCheckField(check, "url")]: connectionCheckMessage(t, check),
          }));
          setCheckFailed(true);
          focusFirstInvalidSoon();
          return;
        }
      }
      setCheckFailed(false);
      const result = await createProvider({
        type: "ldap",
        name: name.trim(),
        draftId,
        config,
        credential: { kind: "bindPassword", secret: draft.password },
      });
      await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
      if (draft.ca) {
        try {
          await setCaCertificate(result.provider.id, draft.ca.pem);
        } catch (failure) {
          setCaFailure({ provider: result.provider, message: problemMessage(t, failure) });
          return;
        }
      }
      onCreated(result.provider);
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };

  const chooseCa = async (file: File) => {
    try {
      set({ ca: { name: file.name, pem: await readFileText(file) } });
      setErrors(({ ca: _ca, ...rest }) => rest);
    } catch {
      setErrors((current) => ({ ...current, ca: t("identityProviders.wizard.fileUnreadable") }));
    }
  };

  if (caFailure) {
    return (
      <>
        <Notice variant="warning" title={t("identityProviders.wizard.caFailedTitle")}>
          <div className="flex flex-col gap-2">
            <p>{caFailure.message}</p>
            <p>{t("identityProviders.wizard.caFailedAction")}</p>
          </div>
        </Notice>
        <WizardFooter
          next={
            <Button variant="primary" onClick={() => onCreated(caFailure.provider)}>
              {t("common.continue")}
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <h2 className="font-semibold text-lg">{t("identityProviders.wizard.ldapTitle")}</h2>
      <SegmentedControl
        label={t("identityProviders.wizard.ldapPreset")}
        value={draft.preset}
        onValueChange={(preset) => set({ preset: preset as DirectoryDraft["preset"] })}
        options={LDAP_PRESETS.map((preset) => ({ value: preset, label: presetLabel(t, "ldap", preset) }))}
      />
      <Notice variant="info">{t(`identityProviders.wizard.ldapHints.${draft.preset}`)}</Notice>
      {error ? (
        <Notice variant="danger" title={t("failures.createProvider")}>
          {error}
        </Notice>
      ) : null}
      <NameField
        kind="ldap"
        value={name}
        error={errors.name}
        onChange={(next) => onCommonChange({ name: next })}
      />
      <Field
        label={t("identityProviders.ldap.url")}
        hint={t("identityProviders.ldap.urlHint")}
        {...(errors.url ? { error: errors.url } : {})}
      >
        <Input
          type="text"
          inputMode="url"
          className="font-mono"
          value={draft.url}
          onChange={(event) => set({ url: event.target.value })}
          onBlur={() => {
            const address = ldapServerAddress(draft.url);
            if (address && address !== draft.url) set({ url: address });
          }}
        />
      </Field>
      {plain ? (
        <div className="flex flex-col gap-1">
          <Switch
            label={t("identityProviders.ldap.startTls")}
            checked={draft.startTls}
            onCheckedChange={(startTls) => set({ startTls })}
          />
          <span className="text-sm text-text-muted">{t("identityProviders.ldap.startTlsHint")}</span>
        </div>
      ) : null}
      {plain && !draft.startTls ? (
        <Notice variant="warning">{t("identityProviders.ldap.plainWarning")}</Notice>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={t("identityProviders.ldap.bindDn")}
          hint={t(serviceAccount.hint)}
          {...(errors.bindDn ? { error: errors.bindDn } : {})}
        >
          <Input
            className="font-mono"
            value={draft.bindDn}
            onChange={(event) => set({ bindDn: event.target.value })}
          />
        </Field>
        <Field
          label={t("identityProviders.credentials.bindPassword")}
          hint={t("identityProviders.credentials.bindPasswordHint")}
          {...(errors.password ? { error: errors.password } : {})}
        >
          <PasswordInput
            autoComplete="new-password"
            value={draft.password}
            onChange={(event) => set({ password: event.target.value })}
          />
        </Field>
        <Field
          label={t("identityProviders.ldap.userBaseDn")}
          hint={t("identityProviders.ldap.userBaseDnHint")}
          {...(errors.userBaseDn ? { error: errors.userBaseDn } : {})}
        >
          <Input
            className="font-mono"
            value={draft.userBaseDn}
            onChange={(event) => set({ userBaseDn: event.target.value })}
          />
        </Field>
        <Field
          label={t("identityProviders.ldap.groupBaseDn")}
          hint={t("identityProviders.ldap.groupBaseDnHint")}
          {...(errors.groupBaseDn ? { error: errors.groupBaseDn } : {})}
        >
          <Input
            className="font-mono"
            value={draft.groupBaseDn}
            onChange={(event) => set({ groupBaseDn: event.target.value })}
          />
        </Field>
      </div>
      <DomainsField
        value={domains}
        error={errors.domains}
        hint={t("identityProviders.accounts.domainsHintDirectory")}
        onChange={(next) => onCommonChange({ domains: next })}
      />
      <div className="flex flex-col gap-2">
        <span className="font-medium">{t("identityProviders.ldap.caTitle")}</span>
        <ChosenFile
          label={t("identityProviders.ldap.caUpload")}
          accept={CERTIFICATE_TYPES}
          file={draft.ca}
          error={errors.ca}
          hint={t("identityProviders.wizard.caHint")}
          onFile={(file) => void chooseCa(file)}
        />
      </div>
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
