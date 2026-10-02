import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Menu,
  Notice,
  Section,
  Select,
  Table,
  TableToolbar,
  TruncatedText,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type IdentityProvider,
  identityKeys,
  type ProviderPreset,
  providerLogoUrl,
  providersQuery,
  removeProvider,
} from "../../api/identity-queries.js";
import { SettingsList } from "../../components/settings-list.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { useInstanceSettingsEditor } from "../instance/general-screen.js";
import { SettingsPage } from "../settings/settings-page.js";
import { EmergencyRecipients } from "./emergency-recipients.js";
import { credentialStatus, presetLabel } from "./provider-labels.js";

export function providerPath(providerId: string, search?: Record<string, string>) {
  return {
    to: "/settings/instance/sign-in-providers/$providerId" as const,
    params: { providerId },
    ...(search ? { search } : {}),
  };
}

export const newProviderPath = { to: "/settings/instance/sign-in-providers/new" as const };

export function ProviderGlyph({ provider }: { provider: Pick<IdentityProvider, "id" | "logoRef"> }) {
  const logo = providerLogoUrl(provider);
  return logo ? (
    <img src={logo} alt="" className="size-icon-md shrink-0 object-contain" />
  ) : (
    <KeyRound aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
  );
}

export function CredentialWarnings({ providers }: { providers: IdentityProvider[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const affected = providers.filter((provider) => provider.warnings.length > 0);
  if (affected.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {affected.map((provider) => {
        const status = credentialStatus(t, format, provider);
        const expired =
          provider.warnings.includes("credentialExpired") || provider.warnings.includes("noCredential");
        return (
          <Notice
            key={provider.id}
            variant={expired ? "danger" : "warning"}
            title={t(expired ? "identityProviders.warnings.stopped" : "identityProviders.warnings.expiring", {
              name: provider.name,
              status: status.label,
            })}
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void navigate(providerPath(provider.id, { tab: "overview" }))}
              >
                {t("identityProviders.warnings.renew")}
              </Button>
            }
          >
            {t(
              expired
                ? "identityProviders.warnings.stoppedAction"
                : "identityProviders.warnings.expiringAction",
            )}
          </Notice>
        );
      })}
    </div>
  );
}

export function ProvidersTable({
  providers,
  canManage,
}: {
  providers: IdentityProvider[];
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const [search, setSearch] = useState("");
  const [preset, setPreset] = useState<ProviderPreset | "all">("all");
  const [removing, setRemoving] = useState<IdentityProvider | null>(null);
  const query = search.trim().toLocaleLowerCase();
  const rows = providers.filter(
    (provider) =>
      (preset === "all" || provider.config.preset === preset) &&
      (query === "" ||
        provider.name.toLocaleLowerCase().includes(query) ||
        provider.config.domains.some((domain) => domain.includes(query))),
  );
  const open = (provider: IdentityProvider) => void navigate(providerPath(provider.id));

  return (
    <div className="flex flex-col gap-3">
      <TableToolbar
        search={{ value: search, onChange: setSearch, label: t("identityProviders.search") }}
        filters={
          <div className="w-field max-w-full">
            <Select
              aria-label={t("identityProviders.filterType")}
              value={preset}
              onValueChange={(value) => setPreset(value as ProviderPreset | "all")}
              options={[
                { value: "all", label: t("identityProviders.allTypes") },
                ...(["entraId", "google", "generic"] as const).map((value) => ({
                  value,
                  label: presetLabel(t, value),
                })),
              ]}
            />
          </div>
        }
        filtersActive={search !== "" || preset !== "all"}
        onResetFilters={() => {
          setSearch("");
          setPreset("all");
        }}
      />
      <Table
        caption={t("identityProviders.providers")}
        rows={rows}
        rowKey={(provider) => provider.id}
        rowLabel={(provider) => t("identityProviders.open", { name: provider.name })}
        onRowClick={open}
        empty={<EmptyState icon={KeyRound} title={t("identityProviders.noMatches")} />}
        columns={[
          {
            key: "name",
            header: t("identityProviders.columns.provider"),
            cell: (provider) => (
              <span className="flex min-w-0 items-center gap-2">
                <ProviderGlyph provider={provider} />
                <TruncatedText text={provider.name} className="font-medium" />
                {provider.deactivatedAt ? (
                  <Badge variant="neutral">{t("identityProviders.status.deactivatedBadge")}</Badge>
                ) : null}
              </span>
            ),
          },
          {
            key: "type",
            header: t("identityProviders.columns.type"),
            cell: (provider) => presetLabel(t, provider.config.preset),
          },
          {
            key: "domains",
            header: t("identityProviders.columns.domains"),
            hideBelow: "md",
            cell: (provider) =>
              provider.config.domains.length === 0 ? (
                <span className="text-text-muted">{t("identityProviders.noDomains")}</span>
              ) : (
                <TruncatedText text={provider.config.domains.join(", ")} className="font-mono text-sm" />
              ),
          },
          {
            key: "credential",
            header: t("identityProviders.columns.credential"),
            cell: (provider) => {
              const status = credentialStatus(t, format, provider);
              return <Badge variant={status.variant}>{status.label}</Badge>;
            },
          },
          {
            key: "actions",
            header: <span className="sr-only">{t("settings.actions")}</span>,
            align: "end",
            cell: (provider) => (
              <Menu
                align="end"
                trigger={
                  <IconButton
                    label={t("identityProviders.moreFor", { name: provider.name })}
                    icon={MoreHorizontal}
                  />
                }
                items={[
                  { label: t("identityProviders.openDetails"), onSelect: () => open(provider) },
                  ...(canManage
                    ? [
                        {
                          label: t("identityProviders.remove"),
                          icon: Trash2,
                          danger: true,
                          onSelect: () => setRemoving(provider),
                        },
                      ]
                    : []),
                ]}
              />
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? undefined : setRemoving(null))}
        title={t("identityProviders.removeTitle", { name: removing?.name ?? "" })}
        description={t("identityProviders.removeDescription")}
        confirmLabel={t("identityProviders.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeProvider(removing.id);
            setRemoving(null);
            await queryClient.invalidateQueries({ queryKey: identityKeys.providers });
          } catch (failure) {
            showFailure(t("failures.removeProvider"), failure);
          }
        }}
      />
    </div>
  );
}

export function InstanceProvidersScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const navigate = useNavigate();
  const providers = useQuery(providersQuery);
  const editor = useInstanceSettingsEditor();
  const canManage = state.can("instance.signIn.manage");
  return (
    <SettingsPage
      width="wide"
      title={t("identityProviders.title")}
      description={t("identityProviders.description")}
      icon={KeyRound}
      actions={
        canManage ? (
          <Button variant="primary" icon={Plus} onClick={() => void navigate(newProviderPath)}>
            {t("identityProviders.add")}
          </Button>
        ) : undefined
      }
    >
      {providers.isError ? (
        <LoadError
          what={t("failures.loadProviders")}
          error={providers.error}
          onRetry={() => providers.refetch()}
        />
      ) : null}
      {providers.data ? (
        providers.data.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t("identityProviders.emptyTitle")}
            description={t("identityProviders.emptyDescription")}
            {...(canManage
              ? {
                  action: (
                    <Button variant="primary" icon={Plus} onClick={() => void navigate(newProviderPath)}>
                      {t("identityProviders.add")}
                    </Button>
                  ),
                }
              : {})}
          />
        ) : (
          <>
            <CredentialWarnings providers={providers.data} />
            <ProvidersTable providers={providers.data} canManage={canManage} />
            <p className="text-sm text-text-muted">{t("identityProviders.domainHint")}</p>
          </>
        )
      ) : null}
      <Section title={t("identityProviders.otherMethods")}>
        <SettingsList {...editor} keys={["auth.passwordSignIn"]} level="instance" />
      </Section>
      <Section title={t("emergencyRecipients.title")}>
        <EmergencyRecipients />
      </Section>
    </SettingsPage>
  );
}
