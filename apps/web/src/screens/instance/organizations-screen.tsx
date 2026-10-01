import { type Language, organizationNameSchema, slugSchema, timeZoneSchema } from "@pagehall/shared";
import { Button, Dialog, Field, IconButton, Input, Menu, Notice, Select, Table } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, MoreHorizontal, Plus } from "lucide-react";
import { useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import {
  instanceAccountsQuery,
  instanceKeys,
  instanceOrganizationsQuery,
} from "../../api/instance-queries.js";
import { queryKeys } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { usePaged, useSorted } from "../../components/table-state.js";
import { problemMessage } from "../../errors/problem-message.js";
import { browserTimeZone, timeZoneOptions } from "../../format/time-zones.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { isLanguage, supportedLanguages } from "../../i18n/index.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useOrganizationState, useSession } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { BreakGlassDialog } from "./break-glass-dialog.js";

const createForm = z.object({
  name: organizationNameSchema,
  slug: z.union([z.literal(""), slugSchema]),
  language: z.enum(["en", "de"]),
  timeZone: timeZoneSchema,
  ownerAccountId: z.string(),
});

export function InstanceOrganizationsScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const format = useFormat();
  const navigate = useNavigate();
  const organizations = useQuery(instanceOrganizationsQuery);
  const [creating, setCreating] = useState(false);
  const [breakGlass, setBreakGlass] = useState<{ id: string; name: string } | null>(null);
  const memberOf = new Set(state.organizations.map((entry) => entry.id));
  const sorted = useSorted(
    organizations.data ?? [],
    { key: "name", direction: "asc" },
    (organization, key) => (key === "created" ? organization.createdAt : organization.name.toLowerCase()),
  );
  const paged = usePaged(sorted.rows, 25);

  return (
    <SettingsPage
      title={t("instance.organizations.title")}
      description={t("instance.organizations.description")}
      icon={Building2}
      actions={
        state.can("instance.organizations.create") ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            {t("instance.organizations.create")}
          </Button>
        ) : null
      }
    >
      <Table
        caption={t("instance.organizations.title")}
        rowKey={(organization) => organization.id}
        rows={paged.rows}
        loading={organizations.isPending}
        sort={sorted.sort}
        onSortChange={sorted.setSort}
        pagination={paged.pagination}
        columns={[
          {
            key: "name",
            header: t("instance.organizations.name"),
            sortable: true,
            cell: (organization) => (
              <div className="flex flex-col">
                <span className="font-medium">{organization.name}</span>
                <span className="font-mono text-sm text-text-muted">{organization.slug}</span>
              </div>
            ),
          },
          {
            key: "language",
            header: t("instance.organizations.language"),
            hideBelow: "sm",
            cell: (organization) =>
              `${translateKey(t, `languages.${organization.language}`)} · ${organization.timeZone}`,
          },
          {
            key: "created",
            header: t("instance.organizations.created"),
            sortable: true,
            hideBelow: "md",
            cell: (organization) => format.date(organization.createdAt),
          },
          {
            key: "actions",
            header: t("settings.actions"),
            align: "end",
            cell: (organization) => (
              <Menu
                align="end"
                trigger={
                  <IconButton
                    label={t("instance.organizations.actionsFor", { name: organization.name })}
                    icon={MoreHorizontal}
                  />
                }
                items={[
                  ...(memberOf.has(organization.id)
                    ? [
                        {
                          label: t("instance.organizations.open"),
                          onSelect: () =>
                            void navigate({
                              to: "/settings/organizations/$organizationId/general",
                              params: { organizationId: organization.id },
                            }),
                        },
                      ]
                    : []),
                  ...(!memberOf.has(organization.id) && state.can("instance.breakGlass.request")
                    ? [
                        {
                          label: t("breakGlass.request"),
                          danger: true,
                          onSelect: () => setBreakGlass(organization),
                        },
                      ]
                    : []),
                  {
                    label: t("instance.organizations.domains"),
                    disabled: !memberOf.has(organization.id),
                    onSelect: () =>
                      void navigate({
                        to: "/settings/organizations/$organizationId/domains-and-guests",
                        params: { organizationId: organization.id },
                      }),
                  },
                ]}
              />
            ),
          },
        ]}
      />
      {creating ? <CreateOrganizationDialog onClose={() => setCreating(false)} /> : null}
      {breakGlass ? <BreakGlassDialog organization={breakGlass} onClose={() => setBreakGlass(null)} /> : null}
    </SettingsPage>
  );
}

function CreateOrganizationDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const state = useOrganizationState();
  const session = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accounts = useQuery({
    ...instanceAccountsQuery,
    enabled: state.can("instance.organizations.manage"),
  });
  const [error, setError] = useState<string | null>(null);
  const me = session.account?.id ?? "";
  const form = useSchemaForm(createForm, {
    defaultValues: {
      name: "",
      slug: "",
      language: isLanguage(i18n.language) ? i18n.language : "en",
      timeZone: browserTimeZone(),
      ownerAccountId: me,
    },
    messages: { slug: t("validation.slug") },
  });
  const owner = form.watch("ownerAccountId");
  const ownerName =
    owner === me
      ? (session.account?.name ?? "")
      : (accounts.data?.find((account) => account.id === owner)?.name ?? "");
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const created = await request(() =>
        api.POST("/api/v1/organizations", {
          body: {
            name: values.name,
            ...(values.slug ? { slug: values.slug } : {}),
            language: values.language,
            timeZone: values.timeZone,
            ...(values.ownerAccountId && values.ownerAccountId !== me
              ? { ownerAccountId: values.ownerAccountId }
              : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: instanceKeys.organizations });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
      await queryClient.invalidateQueries({ queryKey: queryKeys.instanceInfo });
      onClose();
      if (values.ownerAccountId === me)
        await navigate({
          to: "/settings/organizations/$organizationId/general",
          params: { organizationId: created.id },
        });
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("instance.organizations.create")}
      size="md"
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={submitWith(submit)}>
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <Field label={t("instance.organizations.name")} error={form.formState.errors.name?.message}>
          <Input autoFocus {...form.register("name")} />
        </Field>
        <Field
          label={t("organization.general.slug")}
          hint={t("instance.organizations.slugHint")}
          error={form.formState.errors.slug?.message}
        >
          <Input className="font-mono" {...form.register("slug")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("instance.organizations.language")}>
            <Controller
              control={form.control}
              name="language"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => field.onChange(value as Language)}
                  options={supportedLanguages.map((language) => ({
                    value: language,
                    label: t(`languages.${language}`),
                  }))}
                />
              )}
            />
          </Field>
          <Field label={t("setup.organization.timeZone")}>
            <Controller
              control={form.control}
              name="timeZone"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} options={timeZoneOptions()} />
              )}
            />
          </Field>
        </div>
        {accounts.data ? (
          <Field label={t("instance.organizations.owner")} hint={t("instance.organizations.ownerHint")}>
            <Controller
              control={form.control}
              name="ownerAccountId"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  options={accounts.data
                    .filter((account) => account.type === "standard" && account.state === "active")
                    .map((account) => ({
                      value: account.id,
                      label: account.email ? `${account.name} (${account.email})` : account.name,
                    }))}
                />
              )}
            />
          </Field>
        ) : null}
        <AccessImpact
          change="gains"
          people={ownerName ? [ownerName] : []}
          what={t("instance.organizations.ownerImpact")}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={form.formState.isSubmitting}>
            {t("instance.organizations.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
