import { type Language, organizationNameSchema, slugSchema, timeZoneSchema } from "@lunedo/shared";
import {
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  IconButton,
  Input,
  Menu,
  Notice,
  Table,
  TableToolbar,
  TimeZoneCombobox,
} from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { instanceKeys } from "../../api/instance-queries.js";
import { queryKeys } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { AccessImpact } from "../../components/access-impact.js";
import { accountLoader, languageItems } from "../../components/pickers.js";
import { useServerTable } from "../../components/table-state.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { browserTimeZone } from "../../format/time-zones.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { isLanguage } from "../../i18n/index.js";
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

function fetchOrganizations(search: string, cursor: string | null) {
  return request(() =>
    api.GET("/api/v1/instance/organizations", {
      params: { query: { limit: 25, ...(search ? { q: search } : {}), ...(cursor ? { cursor } : {}) } },
    }),
  );
}

export function InstanceOrganizationsScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const format = useFormat();
  const navigate = useNavigate();
  const table = useServerTable([...instanceKeys.organizations], fetchOrganizations);
  const [creating, setCreating] = useState(false);
  const [breakGlass, setBreakGlass] = useState<{ id: string; name: string } | null>(null);
  const memberOf = new Set(state.organizations.map((entry) => entry.id));
  const open = (organizationId: string) =>
    void navigate({ to: "/settings/organizations/$organizationId/general", params: { organizationId } });

  return (
    <SettingsPage
      width="wide"
      title={t("instance.organizations.title")}
      description={t("instance.organizations.description")}
      actions={
        state.can("instance.organizations.create") ? (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            {t("instance.organizations.create")}
          </Button>
        ) : null
      }
    >
      <TableToolbar
        search={{
          ...table.search,
          label: t("instance.organizations.search"),
          placeholder: t("instance.organizations.search"),
        }}
      />
      {table.query.isError ? (
        <LoadError
          what={t("failures.loadOrganizations")}
          error={table.query.error}
          onRetry={() => table.query.refetch()}
        />
      ) : null}
      <Table
        caption={t("instance.organizations.title")}
        rowKey={(organization) => organization.id}
        rows={table.rows}
        loading={table.query.isPending}
        {...(table.pagination ? { pagination: table.pagination } : {})}
        onRowClick={(organization) => {
          if (memberOf.has(organization.id)) open(organization.id);
        }}
        rowLabel={(organization) => t("instance.organizations.openNamed", { name: organization.name })}
        empty={<p className="p-4 text-text-muted">{t("instance.organizations.empty")}</p>}
        columns={[
          {
            key: "name",
            header: t("instance.organizations.name"),
            cell: (organization) => (
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">{organization.name}</span>
                <span className="font-mono text-sm text-text-muted">{organization.slug}</span>
              </div>
            ),
          },
          {
            key: "owners",
            header: t("instance.organizations.owners"),
            cell: (organization) => organization.owners.map((owner) => owner.name).join(", ") || "—",
          },
          {
            key: "members",
            header: t("instance.organizations.members"),
            align: "end",
            cell: (organization) => format.number(organization.memberCount),
          },
          {
            key: "domains",
            header: t("instance.organizations.domainsColumn"),
            hideBelow: "md",
            cell: (organization) => organization.domains.join(", ") || "—",
          },
          {
            key: "language",
            header: t("instance.organizations.language"),
            hideBelow: "sm",
            cell: (organization) =>
              `${translateKey(t, `languages.${organization.language}`)} · ${organization.timeZone.replaceAll("_", " ")}`,
          },
          {
            key: "created",
            header: t("instance.organizations.created"),
            hideBelow: "md",
            cell: (organization) => format.date(organization.createdAt),
          },
          {
            key: "actions",
            sticky: true,
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
  const ownerLoader = useMemo(() => accountLoader(), []);
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
  const [owner, setOwner] = useState<ComboboxItem | null>(
    session.account
      ? { value: me, label: session.account.name, description: session.account.email ?? "" }
      : null,
  );
  const ownerName = owner?.label ?? "";
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
      if (!applyServerFieldErrors(form, t, failure)) setError(problemMessage(t, failure));
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
        {error ? (
          <Notice variant="danger" title={t("failures.createOrganization")}>
            {error}
          </Notice>
        ) : null}
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
                <Combobox
                  aria-label={t("instance.organizations.language")}
                  value={field.value}
                  onValueChange={(value) => {
                    if (value) field.onChange(value as Language);
                  }}
                  items={languageItems(t)}
                />
              )}
            />
          </Field>
          <Field label={t("setup.organization.timeZone")}>
            <Controller
              control={form.control}
              name="timeZone"
              render={({ field }) => (
                <TimeZoneCombobox
                  aria-label={t("setup.organization.timeZone")}
                  value={field.value}
                  locale={i18n.language}
                  onValueChange={(value) => {
                    if (value) field.onChange(value);
                  }}
                />
              )}
            />
          </Field>
        </div>
        {state.can("instance.organizations.manage") ? (
          <Field label={t("instance.organizations.owner")} hint={t("instance.organizations.ownerHint")}>
            <Combobox
              aria-label={t("instance.organizations.owner")}
              value={owner?.value ?? null}
              selectedItem={owner}
              load={ownerLoader}
              onValueChange={(value, item) => {
                setOwner(item);
                form.setValue("ownerAccountId", value ?? me);
              }}
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
