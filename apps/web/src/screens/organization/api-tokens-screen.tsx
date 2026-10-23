import { Button, Table } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiToken } from "../../api/account-queries.js";
import { api } from "../../api/client.js";
import { instanceAccountsQuery } from "../../api/instance-queries.js";
import { membersQuery, organizationKeys, organizationTokensQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { usePaged, useSorted } from "../../components/table-state.js";
import { useSpaceNames } from "../../components/token-content-access.js";
import { RevokeTokenDialog, scopeSummary } from "../../components/token-dialogs.js";
import { useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/api-tokens");

export function OrganizationTokensScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const format = useFormat();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const tokens = useQuery(organizationTokensQuery(organizationId));
  const knowledgeBaseNames = useSpaceNames(
    tokens.data?.flatMap((token) => token.knowledgeBaseIds ?? []) ?? [],
  );
  const members = useQuery(membersQuery(organizationId));
  const accounts = useQuery({ ...instanceAccountsQuery, enabled: state.can("instance.accounts.view") });
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const manage = state.can("organization.integrations.manage");
  const owner = (id: string) =>
    members.data?.find((member) => member.accountId === id)?.name ??
    accounts.data?.find((account) => account.id === id)?.name ??
    t("common.unknown");
  const sorted = useSorted(tokens.data ?? [], { key: "name", direction: "asc" }, (token, key) =>
    key === "expires"
      ? (token.expiresAt ?? "9999")
      : key === "used"
        ? (token.lastUsedAt ?? "")
        : token.name.toLowerCase(),
  );
  const paged = usePaged(sorted.rows, 25);

  return (
    <SettingsPage
      width="wide"
      title={t("tokens.organizationTitle")}
      description={t("tokens.organizationDescription")}
    >
      <Table
        caption={t("tokens.organizationTitle")}
        rowKey={(token) => token.id}
        rows={paged.rows}
        loading={tokens.isPending}
        sort={sorted.sort}
        onSortChange={sorted.setSort}
        pagination={paged.pagination}
        empty={<p className="p-4 text-text-muted">{t("tokens.none")}</p>}
        columns={[
          {
            key: "name",
            header: t("tokens.name"),
            sortable: true,
            cell: (token) => (
              <div className="flex flex-col">
                <span className="font-medium">{token.name}</span>
                <span className="text-sm text-text-muted">{scopeSummary(t, token, knowledgeBaseNames)}</span>
              </div>
            ),
          },
          {
            key: "owner",
            header: t("tokens.owner"),
            hideBelow: "sm",
            cell: (token) => owner(token.accountId),
          },
          {
            key: "expires",
            header: t("tokens.expires"),
            sortable: true,
            hideBelow: "md",
            cell: (token) => (token.expiresAt ? format.date(token.expiresAt) : t("tokens.noExpiry")),
          },
          {
            key: "used",
            header: t("tokens.lastUsedColumn"),
            sortable: true,
            hideBelow: "md",
            cell: (token) => (token.lastUsedAt ? format.relative(token.lastUsedAt) : t("tokens.neverUsed")),
          },
          {
            key: "actions",
            sticky: true,
            header: t("settings.actions"),
            align: "end",
            cell: (token) =>
              manage ? (
                <Button variant="danger" size="sm" onClick={() => setRevoking(token)}>
                  {t("tokens.revoke")}
                </Button>
              ) : null,
          },
        ]}
      />
      <RevokeTokenDialog
        token={revoking}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        onRevoke={async () => {
          if (!revoking) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/organizations/{organizationId}/api-tokens/{tokenId}", {
                params: { path: { organizationId, tokenId: revoking.id } },
              }),
            );
            setRevoking(null);
            await queryClient.invalidateQueries({ queryKey: organizationKeys.tokens(organizationId) });
          } catch (failure) {
            showFailure(t("failures.revokeToken"), failure);
          }
        }}
      />
    </SettingsPage>
  );
}
