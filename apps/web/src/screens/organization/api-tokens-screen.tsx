import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApiToken } from "../../api/account-queries.js";
import { api } from "../../api/client.js";
import { instanceAccountsQuery } from "../../api/instance-queries.js";
import { membersQuery, organizationKeys, organizationTokensQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { useSpaceNames } from "../../components/token-content-access.js";
import { RevokeTokenDialog } from "../../components/token-dialogs.js";
import { TokenTable } from "../../components/token-table.js";
import { useFailureToast } from "../../errors/failure.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/api-tokens");

export function OrganizationTokensScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
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
  return (
    <SettingsPage
      wide
      title={t("tokens.organizationTitle")}
      description={t("tokens.organizationDescription")}
    >
      <TokenTable
        caption={t("tokens.organizationTitle")}
        tokens={tokens.data ?? []}
        loading={tokens.isPending}
        knowledgeBaseNames={knowledgeBaseNames}
        owner={(token) => owner(token.accountId)}
        canManage={manage}
        onRevoke={setRevoking}
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
