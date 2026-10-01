import { groupDescriptionSchema, groupNameSchema } from "@pagehall/shared";
import { Button, Dialog, EmptyState, Field, Input, Notice, Table, Textarea, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { Plus, UsersRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { groupsQuery, organizationKeys } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { usePaged, useSorted } from "../../components/table-state.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/groups");

const groupForm = z.object({ name: groupNameSchema, description: groupDescriptionSchema });

export function GroupsScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const groups = useQuery(groupsQuery(organizationId));
  const [creating, setCreating] = useState(false);
  const sorted = useSorted(groups.data ?? [], { key: "name", direction: "asc" }, (group) =>
    group.name.toLowerCase(),
  );
  const paged = usePaged(sorted.rows, 25);
  const canCreate = state.can("organization.groups.create");

  return (
    <SettingsPage
      title={t("groups.title")}
      description={t("groups.description")}
      icon={UsersRound}
      organizationId={organizationId}
      actions={
        canCreate ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            {t("groups.create")}
          </Button>
        ) : null
      }
    >
      {groups.isSuccess && groups.data.length === 0 ? (
        <EmptyState icon={UsersRound} title={t("groups.none")} description={t("groups.noneDescription")} />
      ) : (
        <Table
          caption={t("groups.title")}
          rowKey={(group) => group.id}
          rows={paged.rows}
          loading={groups.isPending}
          sort={sorted.sort}
          onSortChange={sorted.setSort}
          pagination={paged.pagination}
          columns={[
            {
              key: "name",
              header: t("groups.name"),
              sortable: true,
              cell: (group) => (
                <Link
                  to="/settings/organizations/$organizationId/groups/$groupId"
                  params={{ organizationId, groupId: group.id }}
                  className="font-medium text-accent hover:underline"
                >
                  {group.name}
                </Link>
              ),
            },
            {
              key: "description",
              header: t("groups.descriptionLabel"),
              hideBelow: "sm",
              cell: (group) => group.description || "—",
            },
          ]}
        />
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
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
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
