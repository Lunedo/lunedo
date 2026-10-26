import { groupDescriptionSchema, groupNameSchema } from "@lunedo/shared";
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
  useToast,
} from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Lock, Plus, UsersRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { organizationKeys } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { useServerTable } from "../../components/table-state.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/groups");

const groupForm = z.object({ name: groupNameSchema, description: groupDescriptionSchema });

export function GroupsScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const navigate = useNavigate();
  const table = useServerTable([...organizationKeys.groups(organizationId)], (search, cursor, limit) =>
    request(() =>
      api.GET("/api/v1/organizations/{organizationId}/groups", {
        params: {
          path: { organizationId },
          query: { limit, ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}) },
        },
      }),
    ),
  );
  const [creating, setCreating] = useState(false);
  const format = useFormat();
  const canCreate = state.can("organization.groups.create");
  const empty = table.query.isSuccess && table.rows.length === 0 && !table.search.value;

  return (
    <SettingsPage
      wide
      title={t("groups.title")}
      description={t("groups.description")}
      actions={
        canCreate && !empty ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            {t("groups.create")}
          </Button>
        ) : null
      }
    >
      {empty ? (
        <EmptyState
          icon={UsersRound}
          title={t("groups.none")}
          description={t("groups.noneDescription")}
          {...(canCreate
            ? {
                action: (
                  <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                    {t("groups.create")}
                  </Button>
                ),
              }
            : {})}
        />
      ) : (
        <>
          <TableToolbar
            search={{ ...table.search, label: t("groups.search"), placeholder: t("groups.search") }}
            pagination={table.pagination}
          />
          {table.query.isError ? (
            <LoadError
              what={t("failures.loadGroups")}
              error={table.query.error}
              onRetry={() => table.query.refetch()}
            />
          ) : null}
          <Table
            caption={t("groups.title")}
            rowKey={(group) => group.id}
            rows={table.rows}
            loading={table.query.isPending}
            pagination={table.pagination}
            onRowClick={(group) =>
              void navigate({
                to: "/settings/organizations/$organizationId/groups/$groupId",
                params: { organizationId, groupId: group.id },
              })
            }
            rowLabel={(group) => t("groups.open", { name: group.name })}
            empty={<p className="p-4 text-text-muted">{t("groups.noMatch")}</p>}
            columns={[
              {
                key: "name",
                header: t("groups.name"),
                cell: (group) => <span className="font-medium">{group.name}</span>,
              },
              {
                key: "members",
                header: t("groups.memberCount"),
                align: "end",
                cell: (group) => (
                  <span className="tabular-nums">{format.number(group.memberCount ?? 0)}</span>
                ),
              },
              {
                key: "description",
                header: t("groups.descriptionLabel"),
                hideBelow: "sm",
                cell: (group) => group.description || "—",
              },
              {
                key: "managedBy",
                header: t("groups.managedBy"),
                cell: (group) =>
                  group.managedBy ? (
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="info" icon={Lock}>
                        {t("groups.synchronizedReadOnly", { provider: group.managedBy.providerName })}
                      </Badge>
                      {state.can("instance.signIn.view") ? (
                        <Link
                          to="/settings/instance/sign-in-providers/$providerId"
                          params={{ providerId: group.managedBy.providerId }}
                          search={{ tab: "mapping" }}
                          onClick={(event) => event.stopPropagation()}
                          className="text-sm text-accent hover:underline focus-visible:focus-ring"
                        >
                          {t("groups.mappingRule")}
                        </Link>
                      ) : null}
                    </span>
                  ) : group.formerlySynchronizedFrom ? (
                    t("groups.formerlySynchronized", { provider: group.formerlySynchronizedFrom })
                  ) : (
                    t("groups.managedByLunedo")
                  ),
              },
            ]}
          />
        </>
      )}
      <CreateGroupDialog open={creating} onOpenChange={setCreating} organizationId={organizationId} />
    </SettingsPage>
  );
}

function CreateGroupDialog({
  open,
  onOpenChange,
  organizationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(groupForm, { defaultValues: { name: "", description: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const group = await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/groups", {
          params: { path: { organizationId } },
          body: values,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: organizationKeys.groups(organizationId) });
      toast({ title: t("groups.created"), variant: "success" });
      form.reset();
      onOpenChange(false);
      await navigate({
        to: "/settings/organizations/$organizationId/groups/$groupId",
        params: { organizationId, groupId: group.id },
      });
    } catch (failure) {
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("groups.create")} size="sm">
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? (
          <Notice variant="danger" title={t("failures.createGroup")}>
            {error}
          </Notice>
        ) : null}
        <Field label={t("groups.name")} error={form.formState.errors.name?.message}>
          <Input autoFocus {...form.register("name")} />
        </Field>
        <Field label={t("groups.descriptionLabel")} error={form.formState.errors.description?.message}>
          <Textarea rows={3} {...form.register("description")} />
        </Field>
        <p className="text-sm text-text-muted">{t("groups.creatorManages")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("groups.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
