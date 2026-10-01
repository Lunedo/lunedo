import { Badge, ConfirmDialog, IconButton, Input, Menu, Table, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Search, UserRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import {
  type InstanceAccount,
  instanceAccountsQuery,
  instanceKeys,
  instanceOrganizationsQuery,
} from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { usePaged, useSorted } from "../../components/table-state.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const STATE_BADGES = {
  active: "success",
  invited: "info",
  deactivated: "neutral",
  anonymized: "neutral",
  placeholder: "neutral",
} as const;

export function InstanceAccountsScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const session = useSession();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const accounts = useQuery(instanceAccountsQuery);
  const organizations = useQuery({
    ...instanceOrganizationsQuery,
    enabled: state.can("instance.organizations.view"),
  });
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<{ kind: "deactivate" | "owner"; account: InstanceAccount } | null>(
    null,
  );
  const needle = search.trim().toLowerCase();
  const filtered = (accounts.data ?? []).filter(
    (account) =>
      !needle ||
      account.name.toLowerCase().includes(needle) ||
      (account.email ?? "").toLowerCase().includes(needle),
  );
  const sorted = useSorted(filtered, { key: "name", direction: "asc" }, (account, key) =>
    key === "created" ? account.createdAt : key === "type" ? account.type : account.name.toLowerCase(),
  );
  const paged = usePaged(sorted.rows, 25);
  const homeName = (id: string | null) =>
    id ? (organizations.data?.find((entry) => entry.id === id)?.name ?? "") : "—";

  return (
    <SettingsPage
      title={t("instance.accounts.title")}
      description={t("instance.accounts.description")}
      icon={UserRound}
    >
      <div className="relative w-field max-w-full">
        <Search
          aria-hidden="true"
          className="absolute start-2 top-1/2 size-icon-sm -translate-y-1/2 text-text-muted"
        />
        <Input
          aria-label={t("members.search")}
          placeholder={t("members.search")}
          className="ps-8"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            paged.reset();
          }}
        />
      </div>
      <Table
        caption={t("instance.accounts.title")}
        rowKey={(account) => account.id}
        rows={paged.rows}
        loading={accounts.isPending}
        sort={sorted.sort}
        onSortChange={sorted.setSort}
        pagination={paged.pagination}
        columns={[
          {
            key: "name",
            header: t("members.name"),
            sortable: true,
            cell: (account) => (
              <div className="flex flex-col">
                <span className="font-medium">{account.name}</span>
                <span className="text-sm text-text-muted">{account.email ?? "—"}</span>
              </div>
            ),
          },
          {
            key: "type",
            header: t("instance.accounts.type"),
            sortable: true,
            cell: (account) => t(`instance.accounts.types.${account.type}`),
          },
          {
            key: "state",
            header: t("instance.accounts.state"),
            cell: (account) => (
              <Badge variant={STATE_BADGES[account.state]}>
                {t(`instance.accounts.states.${account.state}`)}
              </Badge>
            ),
          },
          {
            key: "home",
            header: t("instance.accounts.home"),
            hideBelow: "md",
            cell: (account) => homeName(account.homeOrganizationId),
          },
          {
            key: "created",
            header: t("instance.accounts.created"),
            sortable: true,
            hideBelow: "md",
            cell: (account) => format.date(account.createdAt),
          },
          {
            key: "actions",
            header: t("settings.actions"),
            align: "end",
            cell: (account) =>
              account.id === session.account?.id || account.state !== "active" ? null : (
                <Menu
                  align="end"
                  trigger={
                    <IconButton
                      label={t("members.actionsFor", { name: account.name })}
                      icon={MoreHorizontal}
                    />
                  }
                  items={[
                    ...(state.can("instance.ownership.transfer") && account.type === "standard"
                      ? [
                          {
                            label: t("instance.accounts.transferOwnership"),
                            onSelect: () => setPending({ kind: "owner", account }),
                          },
                        ]
                      : []),
                    ...(state.can("instance.accounts.manage")
                      ? [
                          {
                            label: t("members.actions.deactivate"),
                            danger: true,
                            onSelect: () => setPending({ kind: "deactivate", account }),
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
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={
          pending?.kind === "owner"
            ? t("instance.accounts.transferTitle", { name: pending.account.name })
            : t("members.deactivateTitle", { name: pending?.account.name ?? "" })
        }
        description={
          pending?.kind === "owner"
            ? t("instance.accounts.transferDescription")
            : t("members.deactivateDescription")
        }
        confirmLabel={
          pending?.kind === "owner"
            ? t("instance.accounts.transferOwnership")
            : t("members.actions.deactivate")
        }
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!pending) return;
          try {
            if (pending.kind === "owner")
              await request(() =>
                api.POST("/api/v1/instance/ownership", { body: { accountId: pending.account.id } }),
              );
            else
              await request(() =>
                api.POST("/api/v1/accounts/{accountId}/deactivate", {
                  params: { path: { accountId: pending.account.id } },
                }),
              );
            setPending(null);
            await queryClient.invalidateQueries({ queryKey: instanceKeys.accounts });
            await queryClient.invalidateQueries({ queryKey: ["account", "permissions"] });
          } catch (failure) {
            toast({ title: problemMessage(t, failure), variant: "error" });
          }
        }}
      >
        {pending ? (
          <AccessImpact
            change={pending.kind === "owner" ? "gains" : "loses"}
            people={[pending.account.name]}
            what={
              pending.kind === "owner" ? t("instance.accounts.transferImpact") : t("members.deactivateImpact")
            }
          />
        ) : null}
      </ConfirmDialog>
    </SettingsPage>
  );
}
