import { serviceAccountDescriptionSchema, serviceAccountNameSchema } from "@pagehall/shared";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  Table,
  TableToolbar,
  Textarea,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Bot, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { membersQuery, organizationKeys, serviceAccountsQuery } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/service-accounts");

const createForm = z.object({ name: serviceAccountNameSchema, description: serviceAccountDescriptionSchema });

export function ServiceAccountsScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const accounts = useQuery(serviceAccountsQuery(organizationId));
  const members = useQuery(membersQuery(organizationId));
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const rows = (accounts.data ?? []).filter(
    (account) =>
      !needle ||
      account.name.toLowerCase().includes(needle) ||
      (account.description ?? "").toLowerCase().includes(needle),
  );
  const manage = state.can("organization.integrations.manage");
  const names = new Map((members.data ?? []).map((member) => [member.accountId, member.name]));

  return (
    <SettingsPage
      width="wide"
      title={t("serviceAccounts.title")}
      description={t("serviceAccounts.description")}
      icon={Bot}
      organizationId={organizationId}
      actions={
        manage ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            {t("serviceAccounts.create")}
          </Button>
        ) : null
      }
    >
      {accounts.isSuccess && accounts.data.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={t("serviceAccounts.none")}
          description={t("serviceAccounts.noneDescription")}
        />
      ) : (
        <>
          <TableToolbar
            search={{
              value: search,
              onChange: setSearch,
              label: t("groups.search"),
              placeholder: t("groups.search"),
            }}
          />
          <Table
            caption={t("serviceAccounts.title")}
            rowKey={(account) => account.id}
            rows={rows}
            loading={accounts.isPending}
            onRowClick={(account) =>
              void navigate({
                to: "/settings/organizations/$organizationId/service-accounts/$serviceAccountId",
                params: { organizationId, serviceAccountId: account.id },
              })
            }
            rowLabel={(account) => t("serviceAccounts.open", { name: account.name })}
            columns={[
              {
                key: "name",
                header: t("serviceAccounts.name"),
                cell: (account) => <span className="font-medium">{account.name}</span>,
              },
              {
                key: "responsible",
                header: t("serviceAccounts.responsible"),
                hideBelow: "sm",
                cell: (account) =>
                  account.unattended ? (
                    <Badge variant="warning">{t("serviceAccounts.unattended")}</Badge>
                  ) : (
                    account.responsibleAccountIds.map((id) => names.get(id) ?? t("common.unknown")).join(", ")
                  ),
              },
              {
                key: "state",
                header: t("serviceAccounts.state"),
                cell: (account) =>
                  account.state === "active" ? (
                    <Badge variant="success">{t("serviceAccounts.states.active")}</Badge>
                  ) : (
                    <Badge variant="neutral">{t("serviceAccounts.states.deactivated")}</Badge>
                  ),
              },
            ]}
          />
        </>
      )}
      <CreateServiceAccountDialog
        open={creating}
        onOpenChange={setCreating}
        organizationId={organizationId}
      />
    </SettingsPage>
  );
}

function CreateServiceAccountDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(createForm, { defaultValues: { name: "", description: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const created = await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/service-accounts", {
          params: { path: { organizationId } },
          body: values,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: organizationKeys.serviceAccounts(organizationId) });
      form.reset();
      onOpenChange(false);
      await navigate({
        to: "/settings/organizations/$organizationId/service-accounts/$serviceAccountId",
        params: { organizationId, serviceAccountId: created.id },
      });
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("serviceAccounts.create")} size="sm">
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.createServiceAccount")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("serviceAccounts.name")} error={form.formState.errors.name?.message}>
          <Input autoFocus {...form.register("name")} />
        </Field>
        <Field
          label={t("serviceAccounts.descriptionLabel")}
          error={form.formState.errors.description?.message}
        >
          <Textarea rows={2} {...form.register("description")} />
        </Field>
        <p className="text-sm text-text-muted">{t("serviceAccounts.createHint")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("serviceAccounts.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
