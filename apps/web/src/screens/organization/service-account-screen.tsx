import { serviceAccountDescriptionSchema, serviceAccountNameSchema } from "@pagehall/shared";
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  List,
  ListRow,
  Notice,
  Section,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Bot, KeyRound, Plus, PowerOff, UserRound } from "lucide-react";
import { useState } from "react";
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
import { CreateTokenDialog, RevokeTokenDialog, scopeSummary } from "../../components/token-dialogs.js";
import { LoadError, useFailureToast } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
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
  const format = useFormat();
  const showFailure = useFailureToast();
  const queryClient = useQueryClient();
  const account = useQuery({ ...serviceAccountQuery(serviceAccountId), throwOnError: false });
  const tokens = useQuery(serviceAccountTokensQuery(serviceAccountId));
  const [creating, setCreating] = useState(false);
  const lifetime = useQuery({
    ...serviceAccountTokenLifetimeQuery(serviceAccountId),
    enabled: creating,
    throwOnError: false,
  });
  const members = useQuery(membersQuery(organizationId));
  const manage = state.can("organization.integrations.manage");
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [adding, setAdding] = useState("");
  const names = new Map((members.data ?? []).map((member) => [member.accountId, member.name]));
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: organizationKeys.serviceAccount(serviceAccountId) });
    await queryClient.invalidateQueries({
      queryKey: organizationKeys.serviceAccountTokens(serviceAccountId),
    });
    await queryClient.invalidateQueries({ queryKey: organizationKeys.serviceAccounts(organizationId) });
  };
  const updateResponsible = async (ids: string[]) => {
    try {
      await request(() =>
        api.PATCH("/api/v1/service-accounts/{serviceAccountId}", {
          params: { path: { serviceAccountId } },
          body: { responsibleAccountIds: ids },
        }),
      );
      await refresh();
    } catch (failure) {
      showFailure(t("failures.changeServiceAccount"), failure);
    }
  };

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
      icon={Bot}
      organizationId={organizationId}
      breadcrumbs={[
        {
          label: t("serviceAccounts.title"),
          href: `/settings/organizations/${organizationId}/service-accounts`,
        },
        { label: data?.name ?? "" },
      ]}
      actions={
        manage && active ? (
          <Button variant="danger" icon={PowerOff} onClick={() => setDeactivating(true)}>
            {t("serviceAccounts.deactivate")}
          </Button>
        ) : null
      }
    >
      {account.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {data && !active ? <Notice variant="warning">{t("serviceAccounts.deactivatedNotice")}</Notice> : null}
      {data?.unattended ? <Notice variant="warning">{t("serviceAccounts.unattendedNotice")}</Notice> : null}
      {data && manage && active ? <DetailsSection account={data} onSaved={refresh} /> : null}
      {data ? (
        <Section title={t("serviceAccounts.responsible")}>
          <p className="px-4 pt-3 text-sm text-text-muted">{t("serviceAccounts.responsibleHint")}</p>
          <List>
            {data.responsibleAccountIds.map((id) => (
              <ListRow
                key={id}
                icon={UserRound}
                title={names.get(id) ?? t("common.unknown")}
                actions={
                  manage && active ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() =>
                        void updateResponsible(data.responsibleAccountIds.filter((entry) => entry !== id))
                      }
                    >
                      {t("common.remove")}
                    </Button>
                  ) : null
                }
              />
            ))}
          </List>
          {manage && active ? (
            <div className="flex flex-wrap items-center gap-2 p-4">
              <div className="w-field max-w-full">
                <Select
                  aria-label={t("serviceAccounts.addResponsible")}
                  value={adding}
                  onValueChange={setAdding}
                  placeholder={t("roles.choosePerson")}
                  options={(members.data ?? [])
                    .filter((member) => member.kind === "member" && member.accountType === "standard")
                    .filter((member) => !data.responsibleAccountIds.includes(member.accountId))
                    .map((member) => ({ value: member.accountId, label: member.name }))}
                />
              </div>
              <Button
                variant="outline"
                icon={Plus}
                disabled={!adding}
                onClick={() => {
                  void updateResponsible([...data.responsibleAccountIds, adding]);
                  setAdding("");
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
        {tokens.data?.length === 0 ? <p className="px-4 py-3 text-text-muted">{t("tokens.none")}</p> : null}
        <List>
          {tokens.data?.map((token) => (
            <ListRow
              key={token.id}
              icon={KeyRound}
              title={token.name}
              description={[
                scopeSummary(t, token.scopes),
                token.expiresAt
                  ? t("tokens.expiresOn", { date: format.date(token.expiresAt) })
                  : t("tokens.noExpiry"),
                token.lastUsedAt
                  ? t("tokens.lastUsed", { when: format.relative(token.lastUsedAt) })
                  : t("tokens.neverUsed"),
              ].join(" · ")}
              actions={
                manage ? (
                  <Button variant="danger" size="sm" onClick={() => setRevoking(token)}>
                    {t("tokens.revoke")}
                  </Button>
                ) : null
              }
            />
          ))}
        </List>
      </Section>
      <CreateTokenDialog
        open={creating}
        onOpenChange={setCreating}
        maxLifetimeDays={lifetime.data ?? null}
        allowInstance={false}
        allowOrganization
        hint={t("serviceAccounts.tokenHint")}
        onCreate={async (input) => {
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
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(detailsForm, {
    defaultValues: { name: account.name, description: account.description },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() =>
        api.PATCH("/api/v1/service-accounts/{serviceAccountId}", {
          params: { path: { serviceAccountId: account.id } },
          body: values,
        }),
      );
      await onSaved();
      form.reset(values);
      toast({ title: t("common.saved"), variant: "success" });
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  return (
    <Section title={t("serviceAccounts.details")}>
      <form className="flex flex-col gap-4 p-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.saveServiceAccount")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("serviceAccounts.name")} error={form.formState.errors.name?.message}>
          <Input {...form.register("name")} />
        </Field>
        <Field
          label={t("serviceAccounts.descriptionLabel")}
          error={form.formState.errors.description?.message}
        >
          <Textarea rows={2} {...form.register("description")} />
        </Field>
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            loading={form.formState.isSubmitting}
            disabled={!form.formState.isDirty}
          >
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Section>
  );
}
