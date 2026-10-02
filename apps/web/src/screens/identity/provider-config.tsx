import {
  domainSchema,
  emailSources,
  identityProviderNameSchema,
  idTokenAlgorithms,
  signInNameSources,
} from "@pagehall/shared";
import { Badge, CopyButton, Input, Select, SettingRow, Switch } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  type IdentityProvider,
  identityKeys,
  type ProviderConfig,
  type ProviderConfigInput,
  updateProvider,
} from "../../api/identity-queries.js";
import { AutoSaveTextField, SaveIndicator, useSaveStates } from "../../components/auto-save.js";

export function toConfigInput(config: ProviderConfig): ProviderConfigInput {
  const common = {
    clientId: config.clientId,
    domains: config.domains,
    idTokenAlgorithm: config.idTokenAlgorithm,
    accountCreation: config.accountCreation,
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
    return { preset: "google", ...common, ...(config.issuer ? { issuer: String(config.issuer) } : {}) };
  }
  return {
    preset: "generic",
    ...common,
    issuer: String(config.issuer ?? ""),
    scopes: config.scopes,
    claims: config.claims,
  };
}

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

export function useProviderUpdate(provider: IdentityProvider) {
  const queryClient = useQueryClient();
  const store = (next: IdentityProvider) => {
    queryClient.setQueryData(identityKeys.provider(provider.id), next);
    void queryClient.invalidateQueries({ queryKey: identityKeys.providers, exact: true });
  };
  return {
    rename: async (name: string) => store(await updateProvider(provider.id, { name })),
    config: async (change: (current: ProviderConfigInput) => ProviderConfigInput) =>
      store(await updateProvider(provider.id, { config: change(toConfigInput(provider.config)) })),
  };
}

export function NameRow({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const update = useProviderUpdate(provider);
  return (
    <div className="px-4 py-3">
      <AutoSaveTextField
        label={t("identityProviders.fields.name")}
        hint={t("identityProviders.fields.nameHint")}
        value={provider.name}
        schema={identityProviderNameSchema}
        disabled={!canManage}
        onSave={update.rename}
      />
    </div>
  );
}

export function ConnectionFields({
  provider,
  canManage,
}: {
  provider: IdentityProvider;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const update = useProviderUpdate(provider);
  const config = provider.config;
  const tracker = useSaveStates();
  return (
    <>
      <div className="flex flex-col gap-4 px-4 py-3">
        <AutoSaveTextField
          label={t("identityProviders.fields.clientId")}
          value={config.clientId}
          schema={z.string().trim().min(1).max(500)}
          disabled={!canManage}
          className="font-mono"
          onSave={(clientId) => update.config((current) => ({ ...current, clientId }))}
        />
        {config.preset === "entraId" ? (
          <AutoSaveTextField
            label={t("identityProviders.fields.tenantId")}
            hint={t("identityProviders.fields.tenantIdHint")}
            value={config.tenantId}
            schema={z.uuid()}
            disabled={!canManage}
            className="font-mono"
            onSave={(tenantId) =>
              update.config((current) => (current.preset === "entraId" ? { ...current, tenantId } : current))
            }
          />
        ) : null}
        {config.preset === "generic" ? (
          <AutoSaveTextField
            label={t("identityProviders.fields.issuer")}
            hint={t("identityProviders.fields.issuerHint")}
            value={String(config.issuer ?? "")}
            schema={z.url({ protocol: /^https?$/ })}
            disabled={!canManage}
            className="font-mono"
            onSave={(issuer) =>
              update.config((current) => (current.preset === "generic" ? { ...current, issuer } : current))
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

export function AttributeFields({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const update = useProviderUpdate(provider);
  const tracker = useSaveStates();
  const config = provider.config;
  const fixed = (
    <Badge variant="neutral" icon={Lock}>
      {t(`identityProviders.attributes.identifiers.${config.preset}`)}
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
        <p className="px-4 py-3 text-sm text-text-muted">{t("identityProviders.attributes.googleFixed")}</p>
      ) : null}
      {config.preset === "generic" ? (
        <div className="grid grid-cols-1 gap-4 px-4 py-3 sm:grid-cols-2">
          {(["email", "signInName", "displayName", "groups"] as const).map((claim) => (
            <AutoSaveTextField
              key={claim}
              label={t(`identityProviders.attributes.claims.${claim}`)}
              {...(claim === "groups" ? { hint: t("identityProviders.attributes.claims.groupsHint") } : {})}
              value={config.claims[claim] ?? ""}
              schema={claim === "groups" ? z.union([z.literal(""), claimName]) : claimName}
              disabled={!canManage}
              className="font-mono"
              onSave={(value) =>
                update.config((current) =>
                  current.preset === "generic"
                    ? {
                        ...current,
                        claims: {
                          email: config.claims.email,
                          signInName: config.claims.signInName,
                          displayName: config.claims.displayName,
                          groups: config.claims.groups,
                          [claim]: claim === "groups" && value === "" ? null : value,
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

export function AccountFields({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
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
      <div className="px-4 py-3">
        <AutoSaveTextField
          label={t("identityProviders.accounts.domains")}
          hint={
            config.preset === "google"
              ? t("identityProviders.accounts.domainsHintGoogle")
              : t("identityProviders.accounts.domainsHint")
          }
          value={config.domains.join(", ")}
          schema={domainList}
          invalidMessage={t("identityProviders.accounts.domainsInvalid")}
          disabled={!canManage}
          onSave={(value) => update.config((current) => ({ ...current, domains: parseList(value) }))}
        />
      </div>
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
        <div className="px-4 py-3">
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

export function RedirectUriField({ uri }: { uri: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{t("identityProviders.redirectUri")}</span>
      <div className="flex items-center gap-2">
        <Input readOnly value={uri} aria-label={t("identityProviders.redirectUri")} className="font-mono" />
        <CopyButton value={uri} />
      </div>
      <span className="text-sm text-text-muted">{t("identityProviders.redirectUriHint")}</span>
    </div>
  );
}
