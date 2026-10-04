import { Badge, Button, buttonClassName, Notice, Section, Select, SettingRow, Switch } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Lock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  identityKeys,
  refreshSamlMetadata,
  type SamlProvider,
  uploadSamlMetadata,
} from "../../api/identity-queries.js";
import { AutoSaveTextField, SaveIndicator, useSaveStates } from "../../components/auto-save.js";
import { useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { FileButton, readFileText } from "./file-button.js";
import { CopyField, useSamlUpdate, useStoreProvider } from "./provider-config.js";

export const METADATA_TYPES = ".xml,application/xml,text/xml,application/samlmetadata+xml";

const attributeName = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_:./#-]+$/);

const optionalAttribute = z.union([z.literal(""), attributeName]);

export const metadataUrlSchema = z.url({ protocol: /^https?$/ }).max(2048);

export function SamlServiceProviderFields({ provider }: { provider: SamlProvider }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <CopyField
        label={t("identityProviders.saml.entityId")}
        value={provider.saml.entityId}
        hint={t("identityProviders.saml.entityIdHint")}
      />
      <CopyField
        label={t("identityProviders.saml.acsUrl")}
        value={provider.redirectUri}
        hint={t("identityProviders.saml.acsUrlHint")}
      />
      <CopyField
        label={t("identityProviders.saml.metadataUrl")}
        value={provider.saml.metadataUrl}
        hint={t("identityProviders.saml.metadataUrlHint")}
        action={
          <a
            href={provider.saml.metadataUrl}
            download
            className={buttonClassName({ variant: "secondary", className: "shrink-0" })}
          >
            <Download aria-hidden="true" className="size-icon-sm" />
            {t("identityProviders.saml.downloadMetadata")}
          </a>
        }
      />
    </div>
  );
}

function useMetadataActions(provider: SamlProvider) {
  const { t } = useTranslation();
  const store = useStoreProvider();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const [busy, setBusy] = useState<"refresh" | "upload" | null>(null);
  const refresh = async (): Promise<void> => {
    setBusy("refresh");
    try {
      store(await refreshSamlMetadata(provider.id));
    } catch (failure) {
      await queryClient.invalidateQueries({ queryKey: identityKeys.provider(provider.id) });
      showFailure(t("failures.refreshMetadata"), failure, () => void refresh());
    } finally {
      setBusy(null);
    }
  };
  const upload = async (file: File): Promise<void> => {
    setBusy("upload");
    try {
      store(await uploadSamlMetadata(provider.id, await readFileText(file)));
    } catch (failure) {
      showFailure(t("failures.uploadMetadata"), failure);
    } finally {
      setBusy(null);
    }
  };
  return { busy, refresh, upload };
}

export function SamlMetadataSection({ provider, canManage }: { provider: SamlProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const actions = useMetadataActions(provider);
  const source = provider.config.metadata;
  const metadata = provider.saml.identityProvider;
  return (
    <Section title={t("identityProviders.saml.metadataTitle")}>
      {metadata === null ? (
        <div className="px-4 py-3">
          <Notice variant="warning" title={t("identityProviders.saml.noMetadataTitle")}>
            {source.source === "url"
              ? t("identityProviders.saml.noMetadataUrl")
              : t("identityProviders.saml.noMetadataFile")}
          </Notice>
        </div>
      ) : null}
      {metadata?.refreshFailedAt ? (
        <div className="px-4 py-3">
          <Notice variant="danger" title={t("identityProviders.saml.refreshFailedTitle")}>
            {t("identityProviders.warnings.metadataRefreshFailed", {
              name: provider.name,
              time: format.time(metadata.refreshFailedAt),
              error: metadata.refreshError ?? t("common.unknown"),
            })}
          </Notice>
        </div>
      ) : null}
      <SettingRow
        label={t("identityProviders.saml.source")}
        control={
          source.source === "url" ? (
            <span className="break-all font-mono text-sm">{source.url}</span>
          ) : (
            <span>{t("identityProviders.saml.sources.file")}</span>
          )
        }
      />
      {metadata ? (
        <>
          <SettingRow
            label={t("identityProviders.saml.idpEntityId")}
            control={<span className="break-all font-mono text-sm">{metadata.entityId}</span>}
          />
          <SettingRow
            label={t("identityProviders.saml.ssoUrl")}
            control={<span className="break-all font-mono text-sm">{metadata.ssoUrl}</span>}
          />
          <SettingRow
            label={t("identityProviders.saml.certificates")}
            description={t("identityProviders.saml.certificatesHint")}
            control={
              <ul className="flex flex-col gap-1 text-sm">
                {metadata.certificates.map((certificate) => (
                  <li key={certificate.fingerprint} className="flex flex-col">
                    <span className="break-all">{certificate.subject}</span>
                    <span className="text-text-muted">
                      {t("identityProviders.certificate.validUntil", {
                        date: format.date(certificate.expiresAt),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            }
          />
          <SettingRow
            label={t("identityProviders.saml.fetchedAt")}
            control={<span>{format.time(metadata.fetchedAt)}</span>}
          />
        </>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {source.source === "url" ? (
            <Button
              variant="secondary"
              icon={RefreshCw}
              loading={actions.busy === "refresh"}
              onClick={() => void actions.refresh()}
            >
              {t("identityProviders.saml.loadAgain")}
            </Button>
          ) : (
            <FileButton
              label={t("identityProviders.saml.uploadMetadata")}
              accept={METADATA_TYPES}
              icon={FileUp}
              variant="secondary"
              busy={actions.busy === "upload"}
              onFile={(file) => void actions.upload(file)}
            />
          )}
        </div>
      ) : null}
    </Section>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  canManage,
  tracker,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  canManage: boolean;
  tracker: ReturnType<ReturnType<typeof useSaveStates>>;
  onChange: (checked: boolean) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  return (
    <SettingRow
      label={label}
      description={description}
      control={
        <Switch
          label={label}
          labelHidden
          checked={checked}
          disabled={!canManage}
          {...(canManage ? {} : { disabledReason: t("identityProviders.noPermission") })}
          onCheckedChange={(next) => void tracker.run(() => onChange(next))}
        />
      }
      status={<SaveIndicator tracker={tracker} />}
    />
  );
}

export function SamlConnectionFields({
  provider,
  canManage,
}: {
  provider: SamlProvider;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const update = useSamlUpdate(provider);
  const tracker = useSaveStates();
  const config = provider.config;
  const [source, setSource] = useState<"url" | "file">(config.metadata.source);
  return (
    <>
      {config.preset === "entraId" ? (
        <div className="px-4 py-3">
          <AutoSaveTextField
            label={t("identityProviders.fields.tenantId")}
            hint={t("identityProviders.fields.tenantIdHint")}
            value={config.tenantId}
            schema={z.uuid()}
            invalidMessage={t("identityProviders.fields.tenantIdInvalid")}
            disabled={!canManage}
            className="font-mono"
            onSave={(tenantId) =>
              update((current) => (current.preset === "entraId" ? { ...current, tenantId } : current))
            }
          />
        </div>
      ) : null}
      <SettingRow
        label={t("identityProviders.saml.source")}
        description={t("identityProviders.saml.sourceHint")}
        control={
          <Select
            aria-label={t("identityProviders.saml.source")}
            value={source}
            disabled={!canManage}
            onValueChange={(value) => {
              const next = value as "url" | "file";
              setSource(next);
              if (next === "file" && config.metadata.source === "url") {
                void tracker("source").run(() =>
                  update((current) => ({ ...current, metadata: { source: "file" } })),
                );
              }
            }}
            options={(["url", "file"] as const).map((value) => ({
              value,
              label: t(`identityProviders.saml.sources.${value}`),
            }))}
          />
        }
        status={<SaveIndicator tracker={tracker("source")} />}
      />
      {source === "url" ? (
        <div className="px-4 py-3">
          <AutoSaveTextField
            label={t("identityProviders.saml.metadataAddress")}
            hint={t("identityProviders.saml.metadataAddressHint")}
            value={config.metadata.source === "url" ? config.metadata.url : ""}
            schema={metadataUrlSchema}
            invalidMessage={t("validation.url")}
            disabled={!canManage}
            className="font-mono"
            onSave={(url) => update((current) => ({ ...current, metadata: { source: "url", url } }))}
          />
        </div>
      ) : null}
      <SwitchRow
        label={t("identityProviders.saml.idpInitiated")}
        description={t("identityProviders.saml.idpInitiatedHint")}
        checked={config.idpInitiated}
        canManage={canManage}
        tracker={tracker("idpInitiated")}
        onChange={(idpInitiated) => update((current) => ({ ...current, idpInitiated }))}
      />
      <SwitchRow
        label={t("identityProviders.saml.requireSignedResponse")}
        description={t("identityProviders.saml.requireSignedResponseHint")}
        checked={config.requireSignedResponse}
        canManage={canManage}
        tracker={tracker("signedResponse")}
        onChange={(requireSignedResponse) => update((current) => ({ ...current, requireSignedResponse }))}
      />
      <SwitchRow
        label={t("identityProviders.saml.encryptedAssertions")}
        description={t("identityProviders.saml.encryptedAssertionsHint")}
        checked={config.encryptedAssertions}
        canManage={canManage}
        tracker={tracker("encrypted")}
        onChange={(encryptedAssertions) => update((current) => ({ ...current, encryptedAssertions }))}
      />
      {config.preset === "entraId" ? (
        <div className="px-4 py-3">
          <AutoSaveTextField
            label={t("identityProviders.saml.graphClientId")}
            hint={t("identityProviders.saml.graphClientIdHint")}
            value={config.graphClientId ?? ""}
            schema={z.union([z.literal(""), z.string().trim().min(1).max(500)])}
            disabled={!canManage}
            className="font-mono"
            onSave={(value) =>
              update((current) =>
                current.preset === "entraId"
                  ? { ...current, graphClientId: value === "" ? null : value }
                  : current,
              )
            }
          />
        </div>
      ) : null}
    </>
  );
}

export function SamlAttributeFields({ provider, canManage }: { provider: SamlProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const update = useSamlUpdate(provider);
  const tracker = useSaveStates();
  const config = provider.config;
  return (
    <>
      {config.preset === "entraId" ? (
        <>
          <SettingRow
            label={t("identityProviders.attributes.identifier")}
            description={t("identityProviders.attributes.identifierHint")}
            meta={t("identityProviders.attributes.fixed")}
            control={
              <Badge variant="neutral" icon={Lock}>
                {t("identityProviders.attributes.identifiers.saml.entraId")}
              </Badge>
            }
          />
          <SettingRow
            label={t("identityProviders.attributes.email")}
            description={t("identityProviders.attributes.emailHint")}
            control={
              <Select
                aria-label={t("identityProviders.attributes.email")}
                value={config.emailSource}
                disabled={!canManage}
                onValueChange={(value) =>
                  void tracker("email").run(() =>
                    update((current) =>
                      current.preset === "entraId"
                        ? { ...current, emailSource: value as "email" | "userPrincipalName" }
                        : current,
                    ),
                  )
                }
                options={(["email", "userPrincipalName"] as const).map((value) => ({
                  value,
                  label: t(`identityProviders.attributes.samlEmailSources.${value}`),
                }))}
              />
            }
            status={<SaveIndicator tracker={tracker("email")} />}
          />
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 px-4 py-3 sm:grid-cols-2">
          <AutoSaveTextField
            label={t("identityProviders.attributes.saml.identifier")}
            hint={
              config.preset === "generic"
                ? t("identityProviders.attributes.saml.identifierHintGeneric")
                : t("identityProviders.attributes.saml.identifierHint")
            }
            value={config.identifierAttribute ?? ""}
            schema={config.preset === "generic" ? optionalAttribute : attributeName}
            disabled={!canManage}
            className="font-mono"
            onSave={(value) =>
              update((current) => {
                if (current.preset === "generic") {
                  return { ...current, identifierAttribute: value === "" ? null : value };
                }
                return current.preset === "adfs" ? { ...current, identifierAttribute: value } : current;
              })
            }
          />
          {(["email", "signInName", "displayName", "groups"] as const).map((attribute) => (
            <AutoSaveTextField
              key={attribute}
              label={t(`identityProviders.attributes.saml.${attribute}`)}
              {...(attribute === "email"
                ? {}
                : { hint: t("identityProviders.attributes.saml.optionalHint") })}
              value={config.attributes[attribute] ?? ""}
              schema={attribute === "email" ? attributeName : optionalAttribute}
              disabled={!canManage}
              className="font-mono"
              onSave={(value) =>
                update((current) =>
                  current.preset === "entraId"
                    ? current
                    : {
                        ...current,
                        attributes: {
                          email: config.attributes.email,
                          signInName: config.attributes.signInName,
                          displayName: config.attributes.displayName,
                          groups: config.attributes.groups,
                          ...current.attributes,
                          [attribute]: attribute !== "email" && value === "" ? null : value,
                        },
                      },
                )
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
