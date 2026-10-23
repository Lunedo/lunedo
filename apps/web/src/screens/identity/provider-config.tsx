import {
  domainSchema,
  emailSources,
  identityProviderNameSchema,
  idTokenAlgorithms,
  secondFactorModes,
  signInNameSources,
} from "@lunedo/shared";
import { Badge, CopyButton, Input, Select, SettingRow, Switch } from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  type ConnectionCheckBody,
  checkConnection,
  type IdentityProvider,
  identityKeys,
  type LdapConfig,
  type LdapConfigInput,
  type LdapProvider,
  type OidcConfig,
  type OidcConfigInput,
  type OidcProvider,
  type ProviderConfigInput,
  type SamlConfig,
  type SamlConfigInput,
  type SamlProvider,
  updateProvider,
} from "../../api/identity-queries.js";
import { isApiError } from "../../api/request.js";
import {
  AutoSaveTextField,
  ExplicitSaveTextField,
  FieldProblem,
  SaveIndicator,
  useSaveStates,
} from "../../components/auto-save.js";
import { connectionCheckMessage } from "./connection-check.js";

export function oidcConfigInput(config: OidcConfig): OidcConfigInput {
  const common = {
    clientId: config.clientId,
    domains: config.domains,
    idTokenAlgorithm: config.idTokenAlgorithm,
    accountCreation: config.accountCreation,
    sync: config.sync,
    secondFactor: config.secondFactor,
  };
  if (config.preset === "entraId") {
    return {
      preset: "entraId",
      ...common,
      tenantId: config.tenantId,
      ...(config.authority ? { authority: String(config.authority) } : {}),
      ...(config.graphUrl ? { graphUrl: String(config.graphUrl) } : {}),
      emailSource: config.emailSource,
      signInNameSource: config.signInNameSource,
    };
  }
  if (config.preset === "google") {
    return {
      preset: "google",
      ...common,
      ...(config.issuer ? { issuer: String(config.issuer) } : {}),
      directory: config.directory
        ? {
            method: config.directory.method,
            adminEmail: config.directory.adminEmail,
            readUsers: config.directory.readUsers,
            ...(config.directory.url ? { url: String(config.directory.url) } : {}),
            ...(config.directory.tokenUrl ? { tokenUrl: String(config.directory.tokenUrl) } : {}),
          }
        : null,
    };
  }
  return {
    preset: "generic",
    ...common,
    issuer: String(config.issuer ?? ""),
    scopes: config.scopes,
    claims: config.claims,
  };
}

export function samlConfigInput(config: SamlConfig): SamlConfigInput {
  if (config.preset === "entraId") {
    const { authority, graphUrl, ...rest } = config;
    return {
      ...rest,
      ...(authority ? { authority: String(authority) } : {}),
      ...(graphUrl ? { graphUrl: String(graphUrl) } : {}),
    };
  }
  return config;
}

export function ldapConfigInput(config: LdapConfig): LdapConfigInput {
  return config;
}

export function toConfigInput(provider: IdentityProvider): ProviderConfigInput {
  if (provider.type === "saml") return samlConfigInput(provider.config);
  if (provider.type === "ldap") return ldapConfigInput(provider.config);
  return oidcConfigInput(provider.config);
}

const OPTIONAL_CLAIMS: ReadonlySet<string> = new Set(["groups", "groupNames"]);

export function parseList(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const domainList = z.string().superRefine((value, context) => {
  for (const domain of parseList(value)) {
    if (!domainSchema.safeParse(domain).success) {
      context.addIssue({ code: "custom", message: domain });
    }
  }
});

const claimName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_:./-]+$/);

export function useStoreProvider() {
  const queryClient = useQueryClient();
  return (next: IdentityProvider) => {
    queryClient.setQueryData(identityKeys.provider(next.id), next);
    void queryClient.invalidateQueries({ queryKey: identityKeys.providers, exact: true });
  };
}

function useConfigUpdate<C extends ProviderConfigInput>(providerId: string, current: () => C) {
  const store = useStoreProvider();
  return async (change: (current: C) => C) =>
    store(await updateProvider(providerId, { config: change(current()) }));
}

export function useCheckedUpdate<C extends ProviderConfigInput>(
  provider: IdentityProvider,
  current: () => C,
) {
  const { t } = useTranslation();
  const store = useStoreProvider();
  return async (change: (current: C) => C, bindPassword?: string) => {
    const next = change(current());
    let check: Awaited<ReturnType<typeof checkConnection>>;
    try {
      check = await checkConnection({
        type: provider.type,
        config: next,
        providerId: provider.id,
        ...(bindPassword ? { bindPassword } : {}),
      } as ConnectionCheckBody);
    } catch (failure) {
      if (provider.type === "ldap" && isApiError(failure, "invalidInput")) {
        throw new FieldProblem(t("identityProviders.check.passwordNeeded"));
      }
      throw failure;
    }
    if (!check.ok) throw new FieldProblem(connectionCheckMessage(t, check));
    store(await updateProvider(provider.id, { config: next }));
  };
}

export function useProviderUpdate(provider: IdentityProvider) {
  const store = useStoreProvider();
  const config = useConfigUpdate(provider.id, () => toConfigInput(provider));
  return {
    rename: async (name: string) => store(await updateProvider(provider.id, { name })),
    config,
  };
}

export function useOidcUpdate(provider: OidcProvider) {
  return useConfigUpdate(provider.id, () => oidcConfigInput(provider.config));
}

export function useSamlUpdate(provider: SamlProvider) {
  return useConfigUpdate(provider.id, () => samlConfigInput(provider.config));
}

export function useLdapUpdate(provider: LdapProvider) {
  return useConfigUpdate(provider.id, () => ldapConfigInput(provider.config));
}

function useFederatedUpdate(provider: OidcProvider | SamlProvider) {
  return useConfigUpdate<OidcConfigInput | SamlConfigInput>(provider.id, () =>
    provider.type === "saml" ? samlConfigInput(provider.config) : oidcConfigInput(provider.config),
  );
}

export function domainsHintKey(type: IdentityProvider["type"], preset: string) {
  if (type === "ldap") return "identityProviders.accounts.domainsHintDirectory" as const;
  if (preset === "google") return "identityProviders.accounts.domainsHintGoogle" as const;
  if (preset === "entraId") return "identityProviders.accounts.domainsHintEntraId" as const;
  return "identityProviders.accounts.domainsHint" as const;
}

export function providerKind(provider: IdentityProvider): "entraId" | "google" | "oidc" | "saml" | "ldap" {
  if (provider.type !== "oidc") return provider.type;
  return provider.config.preset === "generic" ? "oidc" : provider.config.preset;
}

export function NameRow({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const update = useProviderUpdate(provider);
  return (
    <div className="py-3">
      <AutoSaveTextField
        label={t("identityProviders.fields.name")}
        hint={t(`identityProviders.fields.nameHints.${providerKind(provider)}`)}
        value={provider.name}
        schema={identityProviderNameSchema}
        disabled={!canManage}
        onSave={update.rename}
      />
    </div>
  );
}

export function ConnectionFields({ provider, canManage }: { provider: OidcProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const update = { config: useOidcUpdate(provider) };
  const checked = useCheckedUpdate(provider, () => oidcConfigInput(provider.config));
  const config = provider.config;
  const tracker = useSaveStates();
  return (
    <>
      <div className="flex flex-col gap-4 py-3">
        <ExplicitSaveTextField
          label={t("identityProviders.fields.clientId")}
          value={config.clientId}
          schema={z.string().trim().min(1).max(500)}
          disabled={!canManage}
          className="font-mono"
          onSave={(clientId) => checked((current) => ({ ...current, clientId }))}
        />
        {config.preset === "entraId" ? (
          <ExplicitSaveTextField
            label={t("identityProviders.fields.tenantId")}
            hint={t("identityProviders.fields.tenantIdHint")}
            value={config.tenantId}
            schema={z.uuid()}
            disabled={!canManage}
            className="font-mono"
            onSave={(tenantId) =>
              checked((current) => (current.preset === "entraId" ? { ...current, tenantId } : current))
            }
          />
        ) : null}
        {config.preset === "generic" ? (
          <ExplicitSaveTextField
            label={t("identityProviders.fields.issuer")}
            hint={t("identityProviders.fields.issuerHint")}
            value={String(config.issuer ?? "")}
            schema={z.url({ protocol: /^https?$/ })}
            disabled={!canManage}
            className="font-mono"
            onSave={(issuer) =>
              checked((current) => (current.preset === "generic" ? { ...current, issuer } : current))
            }
          />
        ) : null}
      </div>
      <SettingRow
        label={t("identityProviders.fields.algorithm")}
        description={t("identityProviders.fields.algorithmHint")}
        control={
          <Select
            aria-label={t("identityProviders.fields.algorithm")}
            value={config.idTokenAlgorithm}
            disabled={!canManage}
            onValueChange={(value) =>
              void tracker("algorithm").run(() =>
                update.config((current) => ({
                  ...current,
                  idTokenAlgorithm: value as (typeof idTokenAlgorithms)[number],
                })),
              )
            }
            options={idTokenAlgorithms.map((value) => ({ value, label: value }))}
          />
        }
        status={<SaveIndicator tracker={tracker("algorithm")} />}
      />
    </>
  );
}

export function AttributeFields({ provider, canManage }: { provider: OidcProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const update = { config: useOidcUpdate(provider) };
  const tracker = useSaveStates();
  const config = provider.config;
  const fixed = (
    <Badge variant="neutral" icon={Lock}>
      {t(`identityProviders.attributes.identifiers.oidc.${config.preset}`)}
    </Badge>
  );
  return (
    <>
      <SettingRow
        label={t("identityProviders.attributes.identifier")}
        description={t("identityProviders.attributes.identifierHint")}
        meta={t("identityProviders.attributes.fixed")}
        control={fixed}
      />
      {config.preset === "entraId" ? (
        <>
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
                    update.config((current) =>
                      current.preset === "entraId"
                        ? { ...current, emailSource: value as (typeof emailSources)[number] }
                        : current,
                    ),
                  )
                }
                options={emailSources.map((value) => ({
                  value,
                  label: t(`identityProviders.attributes.emailSources.${value}`),
                }))}
              />
            }
            status={<SaveIndicator tracker={tracker("email")} />}
          />
          <SettingRow
            label={t("identityProviders.attributes.signInName")}
            description={t("identityProviders.attributes.signInNameHint")}
            control={
              <Select
                aria-label={t("identityProviders.attributes.signInName")}
                value={config.signInNameSource}
                disabled={!canManage}
                onValueChange={(value) =>
                  void tracker("signInName").run(() =>
                    update.config((current) =>
                      current.preset === "entraId"
                        ? { ...current, signInNameSource: value as (typeof signInNameSources)[number] }
                        : current,
                    ),
                  )
                }
                options={signInNameSources.map((value) => ({
                  value,
                  label: t(`identityProviders.attributes.signInNameSources.${value}`),
                }))}
              />
            }
            status={<SaveIndicator tracker={tracker("signInName")} />}
          />
        </>
      ) : null}
      {config.preset === "google" ? (
        <p className="py-3 text-sm text-text-muted">{t("identityProviders.attributes.googleFixed")}</p>
      ) : null}
      {config.preset === "generic" ? (
        <div className="grid grid-cols-1 gap-4 py-3 sm:grid-cols-2">
          {(["email", "signInName", "displayName", "groups", "groupNames"] as const).map((claim) => (
            <AutoSaveTextField
              key={claim}
              label={t(`identityProviders.attributes.claims.${claim}`)}
              {...(claim === "groups"
                ? { hint: t("identityProviders.attributes.claims.groupsHint") }
                : claim === "groupNames"
                  ? { hint: t("identityProviders.attributes.claims.groupNamesHint") }
                  : {})}
              value={config.claims[claim] ?? ""}
              schema={OPTIONAL_CLAIMS.has(claim) ? z.union([z.literal(""), claimName]) : claimName}
              disabled={!canManage}
              className="font-mono"
              onSave={(value) =>
                update.config((current) =>
                  current.preset === "generic"
                    ? {
                        ...current,
                        claims: {
                          ...current.claims,
                          [claim]: OPTIONAL_CLAIMS.has(claim) && value === "" ? null : value,
                        },
                      }
                    : current,
                )
              }
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

export function AccountFields({
  provider,
  canManage,
  showDomains = true,
}: {
  provider: IdentityProvider;
  canManage: boolean;
  showDomains?: boolean;
}) {
  const { t } = useTranslation();
  const update = useProviderUpdate(provider);
  const tracker = useSaveStates();
  const config = provider.config;
  const creation = config.accountCreation;
  const [requireGroups, setRequireGroups] = useState(creation.requiredGroups.length > 0);
  const reason = canManage ? undefined : t("identityProviders.noPermission");
  return (
    <>
      <SettingRow
        label={t("identityProviders.accounts.create")}
        description={t("identityProviders.accounts.createHint")}
        control={
          <Switch
            label={t("identityProviders.accounts.create")}
            labelHidden
            checked={creation.enabled}
            disabled={!canManage}
            {...(reason ? { disabledReason: reason } : {})}
            onCheckedChange={(enabled) =>
              void tracker("create").run(() =>
                update.config((current) => ({
                  ...current,
                  accountCreation: { ...creation, enabled },
                })),
              )
            }
          />
        }
        status={<SaveIndicator tracker={tracker("create")} />}
      />
      {showDomains ? (
        <div className="py-3">
          <ExplicitSaveTextField
            label={t("identityProviders.accounts.domains")}
            hint={t(domainsHintKey(provider.type, config.preset))}
            value={config.domains.join(", ")}
            schema={domainList}
            invalidMessage={t("identityProviders.accounts.domainsInvalid")}
            disabled={!canManage}
            onSave={(value) => update.config((current) => ({ ...current, domains: parseList(value) }))}
          />
        </div>
      ) : null}
      <SettingRow
        label={t("identityProviders.accounts.requireGroup")}
        description={t("identityProviders.accounts.requireGroupHint")}
        control={
          <Switch
            label={t("identityProviders.accounts.requireGroup")}
            labelHidden
            checked={requireGroups}
            disabled={!canManage}
            {...(reason ? { disabledReason: reason } : {})}
            onCheckedChange={(checked) => {
              setRequireGroups(checked);
              if (!checked && creation.requiredGroups.length > 0) {
                void tracker("requireGroup").run(() =>
                  update.config((current) => ({
                    ...current,
                    accountCreation: { ...creation, requiredGroups: [] },
                  })),
                );
              }
            }}
          />
        }
        status={<SaveIndicator tracker={tracker("requireGroup")} />}
      />
      {requireGroups ? (
        <div className="py-3">
          <AutoSaveTextField
            label={t("identityProviders.accounts.groups")}
            hint={t("identityProviders.accounts.groupsHint")}
            value={creation.requiredGroups.join(", ")}
            disabled={!canManage}
            className="font-mono"
            onSave={(value) =>
              update.config((current) => ({
                ...current,
                accountCreation: { ...creation, requiredGroups: parseList(value) },
              }))
            }
          />
        </div>
      ) : null}
    </>
  );
}

export function SecondFactorFields({
  provider,
  canManage,
}: {
  provider: OidcProvider | SamlProvider;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const update = { config: useFederatedUpdate(provider) };
  const tracker = useSaveStates();
  const setting = provider.config.secondFactor;
  return (
    <>
      <SettingRow
        label={t("identityProviders.secondFactor.mode")}
        description={t(`identityProviders.secondFactor.hints.${setting.mode}`)}
        control={
          <Select
            aria-label={t("identityProviders.secondFactor.mode")}
            value={setting.mode}
            disabled={!canManage}
            onValueChange={(value) =>
              void tracker("secondFactor").run(() =>
                update.config((current) => ({
                  ...current,
                  secondFactor: { ...setting, mode: value as (typeof secondFactorModes)[number] },
                })),
              )
            }
            options={secondFactorModes.map((value) => ({
              value,
              label: t(`identityProviders.secondFactor.modes.${value}`),
            }))}
          />
        }
        status={<SaveIndicator tracker={tracker("secondFactor")} />}
      />
      {setting.mode === "providerProof" ? (
        <div className="py-3">
          <AutoSaveTextField
            label={t("identityProviders.secondFactor.proofValues")}
            hint={t("identityProviders.secondFactor.proofValuesHint")}
            value={setting.proofValues.join(", ")}
            schema={proofValueList}
            invalidMessage={t("identityProviders.secondFactor.proofValuesInvalid")}
            disabled={!canManage}
            className="font-mono"
            onSave={(value) =>
              update.config((current) => ({
                ...current,
                secondFactor: { ...setting, proofValues: parseList(value) },
              }))
            }
          />
        </div>
      ) : null}
    </>
  );
}

const proofValueList = z.string().refine((value) => {
  const values = parseList(value);
  return values.length > 0 && values.length <= 20 && values.every((item) => item.length <= 50);
});

export function LinkFields() {
  const { t } = useTranslation();
  return (
    <SettingRow
      label={t("identityProviders.accounts.link")}
      description={t("identityProviders.accounts.linkHint")}
      meta={t("identityProviders.accounts.linkFixed")}
      control={
        <Badge variant="neutral" icon={Lock}>
          {t("identityProviders.accounts.confirmationRequired")}
        </Badge>
      }
    />
  );
}

export function CopyField({
  label,
  value,
  hint,
  action,
}: {
  label: string;
  value: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <Input readOnly value={value} aria-label={label} className="font-mono" />
        <CopyButton value={value} />
        {action}
      </div>
      {hint ? <span className="text-sm text-text-muted">{hint}</span> : null}
    </div>
  );
}

export function RedirectUriField({ uri }: { uri: string }) {
  const { t } = useTranslation();
  return (
    <CopyField
      label={t("identityProviders.redirectUri")}
      value={uri}
      hint={t("identityProviders.redirectUriHint")}
    />
  );
}
