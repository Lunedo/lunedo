import {
  Badge,
  Button,
  ConfirmDialog,
  Notice,
  Section,
  SettingRow,
  Skeleton,
  Tabs,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ImageUp, KeyRound, Pause, Play, Trash2 } from "lucide-react";
import { type ComponentType, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  activateProvider,
  deactivateProvider,
  type IdentityProvider,
  identityKeys,
  mappingRulesQuery,
  providerLogoUrl,
  providerQuery,
  removalPreviewQuery,
  removeProvider,
  removeProviderLogo,
  syncRunsQuery,
  uploadProviderLogo,
} from "../../api/identity-queries.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import {
  AccountFields,
  AttributeFields,
  ConnectionFields,
  LinkFields,
  NameRow,
  RedirectUriField,
  SecondFactorFields,
} from "./provider-config.js";
import { CredentialsList } from "./provider-credentials.js";
import { credentialStatus, providerPresetLabel } from "./provider-labels.js";
import {
  CaCertificateSection,
  DirectoryTest,
  LdapAttributeFields,
  LdapConnectionFields,
  LdapSecondFactorFields,
} from "./provider-ldap.js";
import { MappingTab } from "./provider-mapping.js";
import {
  SamlAttributeFields,
  SamlConnectionFields,
  SamlMetadataSection,
  SamlServiceProviderFields,
} from "./provider-saml.js";
import { ScimTab } from "./provider-scim.js";
import { SyncSettings, SyncTab, syncSummary } from "./provider-sync.js";
import { StartTestButton, TestResult } from "./provider-test.js";
import { continueSetupPath } from "./providers-screen.js";

const route = getRouteApi("/app/settings/instance/sign-in-providers/$providerId");

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const LOGO_MAX_BYTES = 256 * 1024;

export interface ProviderTab {
  value: string;
  labelKey: string;
  available: (provider: IdentityProvider) => boolean;
  component: ComponentType<{ provider: IdentityProvider; canManage: boolean }>;
}

export const providerTabs: ProviderTab[] = [
  {
    value: "mapping",
    labelKey: "identityProviders.tabs.mapping",
    component: MappingTab,
    available: (provider) => provider.capabilities.groups || provider.scim,
  },
  { value: "sync", labelKey: "identityProviders.tabs.sync", component: SyncTab, available: () => true },
  { value: "scim", labelKey: "identityProviders.tabs.scim", component: ScimTab, available: () => true },
];

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function InstanceProviderScreen() {
  const { t } = useTranslation();
  const { providerId } = route.useParams();
  const search = route.useSearch();
  const navigate = useNavigate();
  const state = useOrganizationState();
  const provider = useQuery(providerQuery(providerId));
  const canManage = state.can("instance.signIn.manage");
  const tab = search.tab ?? "overview";
  const data = provider.data;

  return (
    <SettingsPage
      width="wide"
      title={data?.name ?? t("identityProviders.details")}
      {...(data
        ? {
            description: [providerPresetLabel(t, data), data.config.domains.join(", ")]
              .filter(Boolean)
              .join(" · "),
          }
        : {})}
      icon={KeyRound}
      breadcrumbs={[
        { label: t("identityProviders.title"), href: "/settings/instance/sign-in-providers" },
        { label: data?.name ?? t("identityProviders.details") },
      ]}
      actions={
        data && data.type !== "ldap" ? (
          <StartTestButton provider={data} returnTo={() => `${globalThis.location.pathname}?tab=overview`} />
        ) : undefined
      }
    >
      {provider.isPending ? <Skeleton className="h-48 w-full" /> : null}
      {provider.isError ? (
        <LoadError
          what={t("failures.loadProvider")}
          error={provider.error}
          onRetry={() => provider.refetch()}
        />
      ) : null}
      {data?.deactivatedAt ? (
        <Notice variant="warning" title={t("identityProviders.status.deactivatedTitle")}>
          {t("identityProviders.status.deactivatedNotice")}
        </Notice>
      ) : null}
      {data && !data.setupComplete ? (
        <Notice
          variant="warning"
          title={t("identityProviders.unfinished.badge")}
          action={
            state.can("instance.signIn.manage") ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void navigate(continueSetupPath({ providerId: data.id }) as never)}
              >
                {t("identityProviders.unfinished.continue")}
              </Button>
            ) : undefined
          }
        >
          {t("identityProviders.unfinished.notice", { name: data.name })}
        </Notice>
      ) : null}
      {data ? (
        <Tabs
          label={t("identityProviders.tabs.label")}
          value={tab}
          onValueChange={(value) => void navigate({ to: ".", search: { tab: value } } as never)}
          tabs={[
            { value: "overview", label: t("identityProviders.tabs.overview") },
            { value: "settings", label: t("identityProviders.tabs.settings") },
            ...providerTabs
              .filter((extra) => extra.available(data))
              .map((extra) => ({ value: extra.value, label: t(extra.labelKey as never) })),
          ]}
        >
          {tab === "overview" ? (
            <Overview provider={data} canManage={canManage} flowId={search.providerTest} />
          ) : null}
          {tab === "settings" ? <Settings provider={data} canManage={canManage} /> : null}
          {providerTabs.map((extra) =>
            extra.value === tab && extra.available(data) ? (
              <extra.component key={extra.value} provider={data} canManage={canManage} />
            ) : null,
          )}
        </Tabs>
      ) : null}
    </SettingsPage>
  );
}

function Overview({
  provider,
  canManage,
  flowId,
}: {
  provider: IdentityProvider;
  canManage: boolean;
  flowId: string | undefined;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const status = credentialStatus(t, format, provider);
  return (
    <div className="flex flex-col gap-6">
      {flowId ? <TestResult provider={provider} flowId={flowId} /> : null}
      {provider.warnings.includes("noGraphCredential") ? (
        <Notice
          variant="warning"
          title={t("identityProviders.warnings.noGraphTitle", { name: provider.name })}
        >
          {t("identityProviders.warnings.noGraph")}
        </Notice>
      ) : null}
      <OverviewTiles provider={provider} />
      {provider.type === "saml" ? <SamlMetadataSection provider={provider} canManage={canManage} /> : null}
      <Section title={t("identityProviders.overview.connection")}>
        <SettingRow
          label={t("identityProviders.overview.credentialStatus")}
          control={<Badge variant={status.variant}>{status.label}</Badge>}
        />
        <SettingRow
          label={t("identityProviders.accounts.domains")}
          description={t("identityProviders.accounts.domainsHint")}
          control={
            provider.config.domains.length === 0 ? (
              <span className="text-text-muted">{t("identityProviders.noDomains")}</span>
            ) : (
              <span className="font-mono text-sm">{provider.config.domains.join(", ")}</span>
            )
          }
        />
        {provider.type === "ldap" ? (
          <SettingRow
            label={t("identityProviders.ldap.url")}
            control={<span className="break-all font-mono text-sm">{provider.config.url}</span>}
          />
        ) : (
          <div className="px-4 py-3">
            {provider.type === "saml" ? (
              <SamlServiceProviderFields provider={provider} />
            ) : (
              <RedirectUriField uri={provider.redirectUri} />
            )}
          </div>
        )}
      </Section>
      {provider.type === "ldap" ? (
        <Section title={t("identityProviders.directoryTest.title")}>
          <div className="px-4 py-3">
            <DirectoryTest provider={provider} />
          </div>
        </Section>
      ) : null}
      <Section title={t("identityProviders.credentials.title")}>
        <div className="px-4 py-3">
          <CredentialsList provider={provider} canManage={canManage} />
        </div>
      </Section>
    </div>
  );
}

function OverviewTiles({ provider }: { provider: IdentityProvider }) {
  const { t } = useTranslation();
  const format = useFormat();
  const rules = useQuery({ ...mappingRulesQuery(provider.id), throwOnError: false });
  const runs = useQuery({ ...syncRunsQuery(provider.id, "all"), throwOnError: false });
  const last = runs.data?.items[0];
  const missing = rules.data?.filter((rule) => rule.group.missing).length ?? 0;
  const status = credentialStatus(t, format, provider);
  const capabilities = provider.capabilities;
  const tiles = [
    capabilities.directorySync && {
      key: "lastSync",
      label: t("identityProviders.overview.lastSync"),
      value: last ? format.time(last.startedAt) : t("identityProviders.overview.never"),
      detail: last ? syncSummary(t, last) : t("identityProviders.overview.noSyncYet"),
    },
    capabilities.groups && {
      key: "rules",
      label: t("identityProviders.overview.mappedGroups"),
      value: String(rules.data?.length ?? 0),
      detail:
        missing > 0
          ? t("identityProviders.overview.missingGroups", { count: missing })
          : t("identityProviders.overview.rulesHint"),
    },
    {
      key: "credential",
      label: t("identityProviders.overview.credentialStatus"),
      value: status.label,
      detail: "",
    },
  ].filter((tile) => tile !== false);
  return (
    <ul
      aria-label={t("identityProviders.overview.summary")}
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
      {tiles.map((tile) => (
        <li key={tile.key} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-4">
          <span className="text-sm text-text-muted">{tile.label}</span>
          <span className="font-semibold text-content">{tile.value}</span>
          {tile.detail ? <span className="text-sm text-text-muted">{tile.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Settings({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <Section title={t("identityProviders.settings.signIn")}>
        <NameRow provider={provider} canManage={canManage} />
        <LogoRow provider={provider} canManage={canManage} />
        {provider.type === "oidc" ? <ConnectionFields provider={provider} canManage={canManage} /> : null}
        {provider.type === "saml" ? <SamlConnectionFields provider={provider} canManage={canManage} /> : null}
        {provider.type === "ldap" ? <LdapConnectionFields provider={provider} canManage={canManage} /> : null}
      </Section>
      {provider.type === "ldap" ? <CaCertificateSection provider={provider} canManage={canManage} /> : null}
      <Section title={t("identityProviders.attributes.mapping")}>
        {provider.type === "oidc" ? <AttributeFields provider={provider} canManage={canManage} /> : null}
        {provider.type === "saml" ? <SamlAttributeFields provider={provider} canManage={canManage} /> : null}
        {provider.type === "ldap" ? <LdapAttributeFields provider={provider} canManage={canManage} /> : null}
      </Section>
      <Section title={t("identityProviders.accounts.newPeople")}>
        <AccountFields provider={provider} canManage={canManage} />
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
      <SyncSettings provider={provider} canManage={canManage} />
      {canManage ? <StatusSection provider={provider} /> : null}
    </div>
  );
}

function LogoRow({ provider, canManage }: { provider: IdentityProvider; canManage: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const logo = providerLogoUrl(provider);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
  };
  const upload = async (file: File) => {
    if (!(LOGO_TYPES as readonly string[]).includes(file.type) || file.size > LOGO_MAX_BYTES) {
      toast({ title: t("failures.uploadLogo"), description: t("problems.invalidLogo"), variant: "error" });
      return;
    }
    setBusy(true);
    try {
      await uploadProviderLogo(provider.id, {
        contentType: file.type as (typeof LOGO_TYPES)[number],
        data: await toBase64(file),
      });
      await refresh();
    } catch (failure) {
      showFailure(t("failures.uploadLogo"), failure);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <SettingRow
      label={t("identityProviders.logo.label")}
      description={t("identityProviders.logo.hint")}
      control={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {logo ? (
            <img
              src={logo}
              alt={t("identityProviders.logo.alt", { name: provider.name })}
              className="h-10 w-auto rounded-sm border border-border bg-surface p-1"
            />
          ) : (
            <span className="text-sm text-text-muted">{t("identityProviders.logo.none")}</span>
          )}
          {canManage ? (
            <>
              <input
                ref={input}
                type="file"
                accept={LOGO_TYPES.join(",")}
                className="sr-only"
                aria-label={t("identityProviders.logo.upload")}
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button variant="outline" icon={ImageUp} loading={busy} onClick={() => input.current?.click()}>
                {logo ? t("identityProviders.logo.replace") : t("identityProviders.logo.upload")}
              </Button>
              {logo ? (
                <Button variant="danger" icon={Trash2} onClick={() => setRemoving(true)}>
                  {t("common.remove")}
                </Button>
              ) : null}
            </>
          ) : null}
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title={t("identityProviders.logo.removeTitle")}
            description={t("identityProviders.logo.removeDescription")}
            confirmLabel={t("common.remove")}
            cancelLabel={t("common.cancel")}
            destructive
            onConfirm={async () => {
              try {
                await removeProviderLogo(provider.id);
                setRemoving(false);
                await refresh();
              } catch (failure) {
                showFailure(t("failures.removeLogo"), failure);
              }
            }}
          />
        </div>
      }
    />
  );
}

function StatusSection({ provider }: { provider: IdentityProvider }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const deactivated = provider.deactivatedAt !== null;
  const refresh = async (updated: IdentityProvider) => {
    queryClient.setQueryData(identityKeys.provider(provider.id), updated);
    await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
  };
  const activate = async () => {
    setBusy(true);
    try {
      await refresh(await activateProvider(provider.id));
      toast({ title: t("identityProviders.status.activated", { name: provider.name }), variant: "success" });
    } catch (failure) {
      showFailure(t("failures.activateProvider"), failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t("identityProviders.status.title")}>
      {deactivated ? (
        <SettingRow
          label={t("identityProviders.status.activateTitle", { name: provider.name })}
          description={t("identityProviders.status.activateDescription")}
          control={
            <Button variant="primary" icon={Play} loading={busy} onClick={() => void activate()}>
              {t("identityProviders.status.activate")}
            </Button>
          }
        />
      ) : (
        <SettingRow
          label={t("identityProviders.status.deactivateTitle", { name: provider.name })}
          description={t("identityProviders.status.deactivateDescription")}
          control={
            <Button variant="secondary" icon={Pause} onClick={() => setConfirming(true)}>
              {t("identityProviders.status.deactivate")}
            </Button>
          }
        />
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("identityProviders.status.deactivateTitle", { name: provider.name })}
        description={t("identityProviders.status.deactivateConfirm")}
        confirmLabel={t("identityProviders.status.deactivate")}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          try {
            await refresh(await deactivateProvider(provider.id));
            setConfirming(false);
            toast({
              title: t("identityProviders.status.deactivated", { name: provider.name }),
              variant: "success",
            });
          } catch (failure) {
            showFailure(t("failures.deactivateProvider"), failure);
          }
        }}
      />
      <RemoveRow provider={provider} />
    </Section>
  );
}

function RemovalPreview({ providerId }: { providerId: string }) {
  const { t } = useTranslation();
  const preview = useQuery({ ...removalPreviewQuery(providerId), throwOnError: false });
  if (preview.isPending) return <Skeleton className="h-24 w-full" />;
  if (preview.isError) {
    return (
      <LoadError
        what={t("failures.loadRemovalPreview")}
        error={preview.error}
        onRetry={() => preview.refetch()}
      />
    );
  }
  const { accountsWithoutSignIn, groups, rules, grants } = preview.data;
  return (
    <div className="flex flex-col gap-3">
      {accountsWithoutSignIn > 0 ? (
        <Notice variant="danger">
          {t("identityProviders.removal.accountsWithoutSignIn", { count: accountsWithoutSignIn })}
        </Notice>
      ) : null}
      <ul
        aria-label={t("identityProviders.removal.consequences")}
        className="flex list-disc flex-col gap-1 pl-5"
      >
        <li>{t("identityProviders.removal.accounts", { count: preview.data.accounts })}</li>
        <li>{t("identityProviders.removal.grants", { count: grants })}</li>
        <li>{t("identityProviders.removal.rules", { count: rules })}</li>
        <li>{t("identityProviders.removal.groups", { count: groups })}</li>
      </ul>
    </div>
  );
}

function RemoveRow({ provider }: { provider: IdentityProvider }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <SettingRow
        label={t("identityProviders.removeTitle", { name: provider.name })}
        description={t("identityProviders.removeDescription")}
        control={
          <Button variant="danger" icon={Trash2} onClick={() => setOpen(true)}>
            {t("identityProviders.remove")}
          </Button>
        }
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("identityProviders.removeTitle", { name: provider.name })}
        description={t("identityProviders.removeConfirm")}
        confirmLabel={t("identityProviders.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          try {
            await removeProvider(provider.id);
            setOpen(false);
            await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
            await navigate({ to: "/settings/instance/sign-in-providers" });
          } catch (failure) {
            showFailure(t("failures.removeProvider"), failure);
          }
        }}
      >
        {open ? <RemovalPreview providerId={provider.id} /> : null}
      </ConfirmDialog>
    </>
  );
}
