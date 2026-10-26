import { serviceAccountDescriptionSchema, serviceAccountNameSchema } from "@lunedo/shared";
import {
  Button,
  Combobox,
  type ComboboxItem,
  ConfirmDialog,
  DangerAction,
  DangerZone,
  Field,
  InlineField,
  List,
  ListRow,
  Notice,
  Section,
  Skeleton,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Plus, PowerOff, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { ApiToken } from "../../api/account-queries.js";
import { api } from "../../api/client.js";
import {
  membersQuery,
  organizationKeys,
  serviceAccountQuery,
  serviceAccountTokenLifetimeQuery,
  serviceAccountTokensQuery,
} from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { AutoSaveTextField } from "../../components/auto-save.js";
import { memberLoader } from "../../components/pickers.js";
import { useSpaceNames } from "../../components/token-content-access.js";
import { CreateTokenDialog, RevokeTokenDialog, TokenRightsDialog } from "../../components/token-dialogs.js";
import { TokenTable } from "../../components/token-table.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/service-accounts/$serviceAccountId");

const detailsForm = z.object({
  name: serviceAccountNameSchema,
  description: serviceAccountDescriptionSchema,
});

export function ServiceAccountScreen() {
  const { t } = useTranslation();
  const { organizationId, serviceAccountId } = route.useParams();
  const state = useOrganizationState();
  const _format = useFormat();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const account = useQuery({ ...serviceAccountQuery(serviceAccountId), throwOnError: false });
  const tokens = useQuery(serviceAccountTokensQuery(serviceAccountId));
  const knowledgeBaseNames = useSpaceNames(
    tokens.data?.flatMap((token) => token.knowledgeBaseIds ?? []) ?? [],
  );
  const [creating, setCreating] = useState(false);
  const lifetime = useQuery({
    ...serviceAccountTokenLifetimeQuery(serviceAccountId),
    enabled: creating,
    throwOnError: false,
  });
  const members = useQuery(membersQuery(organizationId));
  const manage = state.can("organization.integrations.manage");
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [changing, setChanging] = useState<ApiToken | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [adding, setAdding] = useState<ComboboxItem | null>(null);
  const [addingError, setAddingError] = useState(false);
  const toast = useToast().toast;
  const names = new Map((members.data ?? []).map((member) => [member.accountId, member.name]));
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: organizationKeys.serviceAccount(serviceAccountId) });
    await queryClient.invalidateQueries({
      queryKey: organizationKeys.serviceAccountTokens(serviceAccountId),
    });
    await queryClient.invalidateQueries({ queryKey: organizationKeys.serviceAccounts(organizationId) });
  };
  const saveResponsible = async (change: (current: string[]) => string[]) => {
    const current = await queryClient.fetchQuery({ ...serviceAccountQuery(serviceAccountId), staleTime: 0 });
    await request(() =>
      api.PATCH("/api/v1/service-accounts/{serviceAccountId}", {
        params: { path: { serviceAccountId } },
        body: { responsibleAccountIds: change(current.responsibleAccountIds) },
      }),
    );
    await refresh();
  };
  const updateResponsible = async (change: (current: string[]) => string[]) => {
    try {
      await saveResponsible(change);
      return true;
    } catch (failure) {
      showFailure(t("failures.changeServiceAccount"), failure);
      return false;
    }
  };
  const removeResponsible = async (id: string) => {
    if (!(await updateResponsible((current) => current.filter((entry) => entry !== id)))) return;
    toast({
      title: t("serviceAccounts.responsibleRemoved", { name: names.get(id) ?? t("common.unknown") }),
      undo: {
        onUndo: () =>
          void updateResponsible((current) => (current.includes(id) ? current : [...current, id])),
      },
    });
  };

  const responsibleIds = (account.data?.responsibleAccountIds ?? []).join(",");
  const responsibleLoader = useMemo(
    () => memberLoader(organizationId, { exclude: responsibleIds.split(",") }),
    [organizationId, responsibleIds],
  );
  if (account.isError)
    return (
      <LoadError
        what={t("failures.loadServiceAccount")}
        error={account.error}
        onRetry={() => account.refetch()}
      />
    );
  const data = account.data;
  const active = data?.state === "active";

  return (
    <SettingsPage
      title={data?.name ?? ""}
      description={data?.description || t("serviceAccounts.description")}
      back={{
        label: t("serviceAccounts.title"),
        href: `/settings/organizations/${organizationId}/service-accounts`,
      }}
    >
      {account.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {data && !active ? <Notice variant="warning">{t("serviceAccounts.deactivatedNotice")}</Notice> : null}
      {data?.unattended ? <Notice variant="warning">{t("serviceAccounts.unattendedNotice")}</Notice> : null}
      {data && manage && active ? <DetailsSection account={data} onSaved={refresh} /> : null}
      {data ? (
        <Section title={t("serviceAccounts.responsible")}>
          <p className="pt-3 text-sm text-text-muted">{t("serviceAccounts.responsibleHint")}</p>
          <List>
            {data.responsibleAccountIds.map((id) => (
              <ListRow
                key={id}
                icon={UserRound}
                title={names.get(id) ?? t("common.unknown")}
                actions={
                  manage && active ? (
                    <Button variant="danger" size="sm" onClick={() => void removeResponsible(id)}>
                      {t("serviceAccounts.removeResponsible")}
                    </Button>
                  ) : null
                }
              />
            ))}
          </List>
          {manage && active ? (
            <div className="flex flex-wrap items-end gap-2 p-4">
              <InlineField>
                <Field
                  label={t("serviceAccounts.responsiblePerson")}
                  id="responsible-person"
                  {...(addingError ? { error: t("serviceAccounts.choosePersonFirst") } : {})}
                >
                  <Combobox
                    placeholder={t("roles.choosePeople")}
                    value={adding?.value ?? null}
                    selectedItem={adding}
                    load={responsibleLoader}
                    onValueChange={(_value, item) => {
                      setAdding(item);
                      if (item) setAddingError(false);
                    }}
                  />
                </Field>
              </InlineField>
              <Button
                variant="outline"
                icon={Plus}
                onClick={() => {
                  if (!adding) {
                    setAddingError(true);
                    document.getElementById("responsible-person")?.focus();
                    return;
                  }
                  const id = adding.value;
                  void updateResponsible((current) => (current.includes(id) ? current : [...current, id]));
                  setAdding(null);
                }}
              >
                {t("serviceAccounts.addResponsible")}
              </Button>
            </div>
          ) : null}
        </Section>
      ) : null}
      <Section
        title={t("serviceAccounts.tokens")}
        actions={
          manage && active ? (
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              {t("tokens.create")}
            </Button>
          ) : null
        }
      >
        <div className="pt-3">
          <TokenTable
            caption={t("serviceAccounts.tokens")}
            tokens={tokens.data ?? []}
            loading={tokens.isPending}
            knowledgeBaseNames={knowledgeBaseNames}
            canManage={manage}
            onChangeContent={setChanging}
            onRevoke={setRevoking}
          />
        </div>
      </Section>
      {data && manage && active ? (
        <DangerZone title={t("common.dangerZone")}>
          <DangerAction
            title={t("serviceAccounts.deactivate")}
            description={t("serviceAccounts.deactivateSummary")}
            action={
              <Button variant="danger" size="sm" icon={PowerOff} onClick={() => setDeactivating(true)}>
                {t("serviceAccounts.deactivate")}
              </Button>
            }
          />
        </DangerZone>
      ) : null}
      <TokenRightsDialog
        token={changing === null ? null : { ...changing, organizationId }}
        allowInstance={false}
        organizationName={state.organization?.name ?? null}
        onOpenChange={(open) => {
          if (!open) setChanging(null);
        }}
        onSave={async (change) => {
          if (!changing) return;
          await request(() =>
            api.PUT("/api/v1/service-accounts/{serviceAccountId}/tokens/{tokenId}/content-access", {
              params: { path: { serviceAccountId, tokenId: changing.id } },
              body: change,
            }),
          );
          await queryClient.invalidateQueries();
          toast({ title: t("tokens.content.saved"), variant: "success" });
        }}
      />
      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        maxLifetimeDays={lifetime.data ?? null}
        allowInstance={false}
        allowOrganization
        organizationId={organizationId}
        hint={t("serviceAccounts.tokenHint")}
        onCreate={async ({ limitedToOrganization, ...input }) => {
          const created = await request(() =>
            api.POST("/api/v1/service-accounts/{serviceAccountId}/tokens", {
              params: { path: { serviceAccountId } },
              body: { ...input, organizationId },
            }),
          );
          await refresh();
          return created;
        }}
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
              api.DELETE("/api/v1/service-accounts/{serviceAccountId}/tokens/{tokenId}", {
                params: { path: { serviceAccountId, tokenId: revoking.id } },
              }),
            );
            setRevoking(null);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.revokeToken"), failure);
          }
        }}
      />
      <ConfirmDialog
        open={deactivating}
        onOpenChange={setDeactivating}
        title={t("serviceAccounts.deactivateTitle", { name: data?.name ?? "" })}
        description={t("serviceAccounts.deactivateDescription")}
        confirmLabel={t("serviceAccounts.deactivate")}
        cancelLabel={t("common.cancel")}
        destructive
        typedConfirmation={{
          value: data?.name ?? "",
          label: t("common.typeToConfirm", { name: data?.name ?? "" }),
          mismatch: t("common.nameMismatch"),
        }}
        onConfirm={async () => {
          try {
            await request(() =>
              api.POST("/api/v1/service-accounts/{serviceAccountId}/deactivate", {
                params: { path: { serviceAccountId } },
              }),
            );
            setDeactivating(false);
            await refresh();
          } catch (failure) {
            showFailure(t("failures.deactivateServiceAccount"), failure);
          }
        }}
      >
        <AccessImpact
          change="loses"
          people={data ? [data.name] : []}
          what={t("serviceAccounts.deactivateImpact", { count: tokens.data?.length ?? 0 })}
        />
      </ConfirmDialog>
    </SettingsPage>
  );
}

function DetailsSection({
  account,
  onSaved,
}: {
  account: { id: string; name: string; description: string };
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const save = async (patch: { name: string } | { description: string }) => {
    await request(() =>
      api.PATCH("/api/v1/service-accounts/{serviceAccountId}", {
        params: { path: { serviceAccountId: account.id } },
        body: patch,
      }),
    );
    await onSaved();
  };
  return (
    <Section title={t("serviceAccounts.details")}>
      <div className="flex flex-col gap-4 p-4">
        <AutoSaveTextField
          label={t("serviceAccounts.name")}
          value={account.name}
          schema={detailsForm.shape.name}
          onSave={(name) => save({ name })}
        />
        <AutoSaveTextField
          label={t("serviceAccounts.descriptionLabel")}
          value={account.description}
          schema={detailsForm.shape.description}
          multiline
          onSave={(description) => save({ description })}
        />
      </div>
    </Section>
  );
}
