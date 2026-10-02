import { Badge, Button, ConfirmDialog, Section, SettingRow, Skeleton, Tabs, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ImageUp, KeyRound, Trash2 } from "lucide-react";
import { type ComponentType, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type IdentityProvider,
  identityKeys,
  mappingRulesQuery,
  providerLogoUrl,
  providerQuery,
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
} from "./provider-config.js";
import { CredentialsList } from "./provider-credentials.js";
import { credentialStatus, presetLabel } from "./provider-labels.js";
import { MappingTab } from "./provider-mapping.js";
import { SyncSettings, SyncTab, syncSummary } from "./provider-sync.js";
import { StartTestButton, TestResult } from "./provider-test.js";

const route = getRouteApi("/app/settings/instance/sign-in-providers/$providerId");

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const LOGO_MAX_BYTES = 256 * 1024;

export interface ProviderTab {
  value: string;
  labelKey: string;
  component: ComponentType<{ provider: IdentityProvider; canManage: boolean }>;
}

export const providerTabs: ProviderTab[] = [
  { value: "mapping", labelKey: "identityProviders.tabs.mapping", component: MappingTab },
  { value: "sync", labelKey: "identityProviders.tabs.sync", component: SyncTab },
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
            description: [presetLabel(t, data.config.preset), data.config.domains.join(", ")]
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
        data ? (
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
      {data ? (
        <Tabs
          label={t("identityProviders.tabs.label")}
          value={tab}
          onValueChange={(value) => void navigate({ to: ".", search: { tab: value } } as never)}
          tabs={[
            { value: "overview", label: t("identityProviders.tabs.overview") },
            { value: "settings", label: t("identityProviders.tabs.settings") },
            ...providerTabs.map((extra) => ({ value: extra.value, label: t(extra.labelKey as never) })),
          ]}
        >
          {tab === "overview" ? (
            <Overview provider={data} canManage={canManage} flowId={search.providerTest} />
          ) : null}
          {tab === "settings" ? <Settings provider={data} canManage={canManage} /> : null}
          {providerTabs.map((extra) =>
            extra.value === tab ? (
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
      <OverviewTiles provider={provider} />
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
        <div className="px-4 py-3">
          <RedirectUriField uri={provider.redirectUri} />
        </div>
      </Section>
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
  const tiles = [
    {
      key: "lastSync",
      label: t("identityProviders.overview.lastSync"),
      value: last ? format.time(last.startedAt) : t("identityProviders.overview.never"),
      detail: last ? syncSummary(t, last) : t("identityProviders.overview.noSyncYet"),
    },
    {
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
  ];
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
        <ConnectionFields provider={provider} canManage={canManage} />
      </Section>
      <Section title={t("identityProviders.attributes.mapping")}>
        <AttributeFields provider={provider} canManage={canManage} />
      </Section>
      <Section title={t("identityProviders.accounts.newPeople")}>
        <AccountFields provider={provider} canManage={canManage} />
      </Section>
      <Section title={t("identityProviders.accounts.existing")}>
        <LinkFields />
      </Section>
      <SyncSettings provider={provider} canManage={canManage} />
      {canManage ? <RemoveSection provider={provider} /> : null}
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

function RemoveSection({ provider }: { provider: IdentityProvider }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const [open, setOpen] = useState(false);
  return (
    <Section title={t("identityProviders.removeSection")}>
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
        description={t("identityProviders.removeDescription")}
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
      />
    </Section>
  );
}
