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
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { KeyRound, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  draftsQuery,
  type IdentityProvider,
  identityKeys,
  type ProviderDraft,
  type ProviderType,
  providerLogoUrl,
  providersQuery,
  providerTypes,
  removeDraft,
  removeProvider,
} from "../../api/identity-queries.js";
import { SettingsList } from "../../components/settings-list.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { useInstanceSettingsEditor } from "../instance/general-screen.js";
import { SettingsPage } from "../settings/settings-page.js";
import { EmergencyRecipients } from "./emergency-recipients.js";
import { credentialStatus, providerPresetLabel, typeLabel } from "./provider-labels.js";

export function providerPath(providerId: string, search?: Record<string, string>) {
  return {
    to: "/settings/instance/sign-in-providers/$providerId" as const,
    params: { providerId },
    ...(search ? { search } : {}),
  };
}

export const newProviderPath = { to: "/settings/instance/sign-in-providers/new" as const };

export function continueSetupPath(target: { providerId: string } | { draftId: string }) {
  return {
    to: "/settings/instance/sign-in-providers/new" as const,
    search:
      "providerId" in target
        ? { providerId: target.providerId, step: 2 }
        : { draftId: target.draftId, step: 1 },
  };
}

function UnfinishedSetups({ providers, canManage }: { providers: IdentityProvider[]; canManage: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showFailure = useFailureToast();
  const drafts = useQuery({ ...draftsQuery, throwOnError: false });
  const [removing, setRemoving] = useState<ProviderDraft | null>(null);
  const unfinished = providers.filter((provider) => !provider.setupComplete);
  const items = [
    ...(drafts.data ?? []).map((draft) => ({
      key: draft.id,
      name: draft.name,
      type: draft.type,
      detail: t("identityProviders.unfinished.draft", { date: format.dateTime(draft.updatedAt) }),
      target: { draftId: draft.id },
      draft,
    })),
    ...unfinished.map((provider) => ({
      key: provider.id,
      name: provider.name,
      type: provider.type,
      detail: t("identityProviders.unfinished.connected"),
      target: { providerId: provider.id },
      draft: null,
    })),
  ];
  if (drafts.isError) {
    return (
      <LoadError what={t("failures.loadDrafts")} error={drafts.error} onRetry={() => drafts.refetch()} />
    );
  }
  if (items.length === 0) return null;
  return (
    <Section title={t("identityProviders.unfinished.title")}>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-3 py-3">
            <KeyRound aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
            <span className="flex min-w-0 flex-1 flex-col">
              <TruncatedText text={item.name} className="font-medium" />
              <span className="text-sm text-text-muted">
                {typeLabel(t, item.type)} · {item.detail}
              </span>
            </span>
            {canManage ? (
              <span className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void navigate(continueSetupPath(item.target) as never)}
                >
                  {t("identityProviders.unfinished.continue")}
                </Button>
                {item.draft ? (
                  <Button size="sm" variant="danger" icon={Trash2} onClick={() => setRemoving(item.draft)}>
                    {t("common.removeDraft")}
                  </Button>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? undefined : setRemoving(null))}
        title={t("identityProviders.unfinished.removeTitle", { name: removing?.name ?? "" })}
        description={t("identityProviders.unfinished.removeDescription")}
        confirmLabel={t("common.removeDraft")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeDraft(removing.id);
            setRemoving(null);
            await queryClient.invalidateQueries({ queryKey: identityKeys.drafts });
          } catch (failure) {
            showFailure(t("failures.removeDraft"), failure);
          }
        }}
      />
    </Section>
  );
}

export function ProviderGlyph({ provider }: { provider: Pick<IdentityProvider, "id" | "logoRef"> }) {
  const logo = providerLogoUrl(provider);
  return logo ? (
    <img src={logo} alt="" className="size-icon-md shrink-0 object-contain" />
  ) : (
    <KeyRound aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
  );
}

const CREDENTIAL_WARNINGS = new Set(["noCredential", "credentialExpiring", "credentialExpired"]);

export function ProviderWarnings({ providers }: { providers: IdentityProvider[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const navigate = useNavigate();
  const open = (provider: IdentityProvider, tab: string) => void navigate(providerPath(provider.id, { tab }));
  return (
    <div className="flex flex-col gap-3 empty:hidden">
      {providers.flatMap((provider) => {
        const notices = [];
        if (provider.warnings.some((warning) => CREDENTIAL_WARNINGS.has(warning))) {
          const status = credentialStatus(t, format, provider);
          const expired =
            provider.warnings.includes("credentialExpired") || provider.warnings.includes("noCredential");
          notices.push(
            <Notice
              key={`${provider.id}-credential`}
              variant={expired ? "danger" : "warning"}
              title={t(
                expired ? "identityProviders.warnings.stopped" : "identityProviders.warnings.expiring",
                {
                  name: provider.name,
                  status: status.label,
                },
              )}
              action={
                <Button size="sm" variant="secondary" onClick={() => open(provider, "overview")}>
                  {t("identityProviders.warnings.renew")}
                </Button>
              }
            >
              {t(
                expired
                  ? "identityProviders.warnings.stoppedAction"
                  : "identityProviders.warnings.expiringAction",
              )}
            </Notice>,
          );
        }
        if (
          provider.type === "saml" &&
          provider.warnings.includes("metadataRefreshFailed") &&
          provider.saml.identityProvider?.refreshFailedAt
        ) {
          const metadata = provider.saml.identityProvider;
          notices.push(
            <Notice
              key={`${provider.id}-metadata`}
              variant="warning"
              title={t("identityProviders.warnings.metadataTitle", { name: provider.name })}
              action={
                <Button size="sm" variant="secondary" onClick={() => open(provider, "overview")}>
                  {t("identityProviders.openDetails")}
                </Button>
              }
            >
              {t("identityProviders.warnings.metadataRefreshFailed", {
                name: provider.name,
                time: format.time(metadata.refreshFailedAt ?? metadata.fetchedAt),
                error: metadata.refreshError ?? t("common.unknown"),
              })}
            </Notice>,
          );
        }
        if (provider.warnings.includes("noGraphCredential")) {
          notices.push(
            <Notice
              key={`${provider.id}-graph`}
              variant="warning"
              title={t("identityProviders.warnings.noGraphTitle", { name: provider.name })}
              action={
                <Button size="sm" variant="secondary" onClick={() => open(provider, "settings")}>
                  {t("identityProviders.warnings.openSettings")}
                </Button>
              }
            >
              {t("identityProviders.warnings.noGraph")}
            </Notice>,
          );
        }
        if (
          provider.type === "ldap" &&
          provider.warnings.includes("caCertificateExpiring") &&
          provider.ldap.caCertificate
        ) {
          notices.push(
            <Notice
              key={`${provider.id}-ca`}
              variant="warning"
              title={t("identityProviders.warnings.caExpiring", {
                name: provider.name,
                date: format.date(provider.ldap.caCertificate.expiresAt),
              })}
              action={
                <Button size="sm" variant="secondary" onClick={() => open(provider, "settings")}>
                  {t("identityProviders.warnings.openSettings")}
                </Button>
              }
            >
              {t("identityProviders.warnings.caExpiringAction")}
            </Notice>,
          );
        }
        return notices;
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
  const [type, setType] = useState<ProviderType | "all">("all");
  const [removing, setRemoving] = useState<IdentityProvider | null>(null);
  const query = search.trim().toLocaleLowerCase();
  const rows = providers.filter(
    (provider) =>
      (type === "all" || provider.type === type) &&
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
              value={type}
              onValueChange={(value) => setType(value as ProviderType | "all")}
              options={[
                { value: "all", label: t("identityProviders.allTypes") },
                ...providerTypes.map((value) => ({ value, label: typeLabel(t, value) })),
              ]}
            />
          </div>
        }
        filtersActive={search !== "" || type !== "all"}
        onResetFilters={() => {
          setSearch("");
          setType("all");
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
                {provider.setupComplete ? null : (
                  <Badge variant="warning">{t("identityProviders.unfinished.badge")}</Badge>
                )}
              </span>
            ),
          },
          {
            key: "type",
            header: t("identityProviders.columns.type"),
            cell: (provider) => (
              <span className="flex min-w-0 flex-col">
                <span>{typeLabel(t, provider.type)}</span>
                <TruncatedText text={providerPresetLabel(t, provider)} className="text-sm text-text-muted" />
              </span>
            ),
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
            sticky: true,
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
                  ...(canManage && !provider.setupComplete
                    ? [
                        {
                          label: t("identityProviders.unfinished.continue"),
                          onSelect: () =>
                            void navigate(continueSetupPath({ providerId: provider.id }) as never),
                        },
                      ]
                    : []),
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
      title={t("identityProviders.title")}
      description={t("identityProviders.description")}
      actions={
        canManage && (providers.data?.length ?? 0) > 0 ? (
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
      {providers.data ? <UnfinishedSetups providers={providers.data} canManage={canManage} /> : null}
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
            <ProviderWarnings providers={providers.data} />
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
