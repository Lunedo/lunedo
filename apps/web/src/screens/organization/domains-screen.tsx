import { domainSchema } from "@pagehall/shared";
import { Button, ConfirmDialog, Field, Input, List, ListRow, Notice, Section, useToast } from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Globe, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import {
  domainsQuery,
  organizationKeys,
  organizationQuery,
  organizationSettingsQuery,
} from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useOrganizationSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/domains-and-guests");

const domainForm = z.object({ domain: domainSchema });

export function DomainsScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const organization = useQuery(organizationQuery(organizationId));
  const domains = useQuery(domainsQuery(organizationId));
  const settings = useQuery(organizationSettingsQuery(organizationId));
  const mutation = useOrganizationSettingMutation(organizationId);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const manageDomains = state.can("instance.organizations.manage");
  const name = organization.data?.name ?? "";
  const form = useSchemaForm(domainForm, {
    defaultValues: { domain: "" },
    messages: { domain: t("validation.domain") },
  });
  const add = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() =>
        api.POST("/api/v1/organizations/{organizationId}/domains", {
          params: { path: { organizationId } },
          body: values,
        }),
      );
      form.reset();
      await queryClient.invalidateQueries({ queryKey: organizationKeys.domains(organizationId) });
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  const onChange = async (key: string, change: Parameters<typeof mutation.mutateAsync>[0]["change"]) => {
    await mutation.mutateAsync({ key, change }).catch((failure: unknown) => {
      toast({ title: problemMessage(t, failure), variant: "error" });
    });
  };

  return (
    <SettingsPage
      title={t("organization.domains.title")}
      description={t("organization.domains.description")}
      icon={Globe}
      organizationId={organizationId}
    >
      <Section title={t("organization.domains.domains")}>
        <p className="px-4 pt-3 text-sm text-text-muted">{t("organization.domains.domainsHint", { name })}</p>
        {domains.data?.length === 0 ? (
          <p className="px-4 py-3 text-text-muted">{t("organization.domains.none")}</p>
        ) : null}
        <List>
          {domains.data?.map((entry) => (
            <ListRow
              key={entry.domain}
              icon={Globe}
              title={entry.domain}
              actions={
                manageDomains ? (
                  <Button variant="danger" size="sm" onClick={() => setRemoving(entry.domain)}>
                    {t("common.remove")}
                  </Button>
                ) : null
              }
            />
          ))}
        </List>
        {manageDomains ? (
          <form className="flex flex-wrap items-start gap-2 p-4" noValidate onSubmit={submitWith(add)}>
            <div className="w-field max-w-full">
              <Field
                label={t("organization.domains.domain")}
                error={form.formState.errors.domain?.message ?? error ?? undefined}
              >
                <Input placeholder={t("organization.domains.placeholder")} {...form.register("domain")} />
              </Field>
            </div>
            <div className="pt-6">
              <Button type="submit" variant="outline" icon={Plus} loading={form.formState.isSubmitting}>
                {t("organization.domains.add")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="p-4">
            <Notice variant="info">{t("organization.domains.instanceManaged")}</Notice>
          </div>
        )}
      </Section>
      <Section title={t("organization.domains.registration")}>
        <SettingsList
          settings={settings.data}
          keys={["organizations.selfRegistration", "organizations.membersCreateGroups"]}
          level="organization"
          organizationName={name}
          canManage={() => state.can("organization.settings.manage")}
          onChange={onChange}
        />
      </Section>
      <Section title={t("organization.domains.guests")}>
        <SettingsList
          settings={settings.data}
          keys={[
            "organizations.guestExpiryReminderDays",
            "organizations.guestInactivityDays",
            "organizations.expiryReminderDays",
          ]}
          level="organization"
          organizationName={name}
          canManage={() => state.can("organization.settings.manage")}
          onChange={onChange}
        />
      </Section>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("organization.domains.removeTitle", { domain: removing ?? "" })}
        description={t("organization.domains.removeDescription")}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/organizations/{organizationId}/domains/{domain}", {
                params: { path: { organizationId, domain: removing } },
              }),
            );
            setRemoving(null);
            await queryClient.invalidateQueries({ queryKey: organizationKeys.domains(organizationId) });
          } catch (failure) {
            toast({ title: problemMessage(t, failure), variant: "error" });
          }
        }}
      />
    </SettingsPage>
  );
}
