import { organizationNameSchema, slugSchema } from "@pagehall/shared";
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  Notice,
  Section,
  SettingRow,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { Building2, ImageUp, LogOut, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import {
  organizationKeys,
  organizationQuery,
  organizationSettingsQuery,
} from "../../api/organization-queries.js";
import { queryKeys } from "../../api/queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { problemMessage } from "../../errors/problem-message.js";
import { applyServerFieldErrors, submitWith, useSchemaForm } from "../../forms/use-schema-form.js";
import { useOrganizationSettingMutation } from "../../settings/setting-mutations.js";
import { organizationLogoUrl } from "../../shell/brand.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/general");

const profileForm = z.object({ name: organizationNameSchema, slug: slugSchema });

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const LOGO_MAX_BYTES = 256 * 1024;

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function OrganizationGeneralScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const organization = useQuery(organizationQuery(organizationId));
  const settings = useQuery(organizationSettingsQuery(organizationId));
  const mutation = useOrganizationSettingMutation(organizationId);
  const { toast } = useToast();
  const canUpdate = state.can("organization.update");
  const canManageSettings = state.can("organization.settings.manage");
  const membership = state.organizations.find((entry) => entry.id === organizationId);

  return (
    <SettingsPage
      title={t("organization.general.title")}
      description={t("organization.general.description")}
      icon={Building2}
      organizationId={organizationId}
    >
      {organization.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {organization.data ? (
        <ProfileSection
          key={organization.data.id + organization.data.slug}
          organization={organization.data}
          editable={canUpdate}
        />
      ) : null}
      <Section title={t("organization.general.branding")}>
        {organization.data ? <LogoRow organization={organization.data} editable={canUpdate} /> : null}
        <SettingsList
          settings={settings.data}
          keys={["branding.accentColor"]}
          level="organization"
          {...(organization.data ? { organizationName: organization.data.name } : {})}
          canManage={() => canManageSettings}
          onChange={async (key, change) => {
            await mutation.mutateAsync({ key, change }).catch((error: unknown) => {
              toast({ title: problemMessage(t, error), variant: "error" });
            });
          }}
        />
      </Section>
      <Section title={t("organization.general.localeDefaults")}>
        <SettingsList
          settings={settings.data}
          keys={[
            "locale.language",
            "locale.timeZone",
            "locale.dateFormat",
            "locale.timeFormat",
            "locale.numberFormat",
            "locale.firstDayOfWeek",
          ]}
          level="organization"
          {...(organization.data ? { organizationName: organization.data.name } : {})}
          canManage={() => canManageSettings}
          onChange={async (key, change) => {
            await mutation.mutateAsync({ key, change }).catch((error: unknown) => {
              toast({ title: problemMessage(t, error), variant: "error" });
            });
          }}
        />
      </Section>
      {membership && membership.membershipKind !== "member" && state.can("organization.leave") ? (
        <LeaveSection organizationId={organizationId} name={membership.name} />
      ) : null}
    </SettingsPage>
  );
}

function ProfileSection({
  organization,
  editable,
}: {
  organization: { id: string; name: string; slug: string };
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useSchemaForm(profileForm, {
    defaultValues: { name: organization.name, slug: organization.slug },
    messages: { slug: t("validation.slug") },
  });
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await request(() =>
        api.PATCH("/api/v1/organizations/{organizationId}", {
          params: { path: { organizationId: organization.id } },
          body: values,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: organizationKeys.organization(organization.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
      toast({ title: t("common.saved"), variant: "success" });
    } catch (failure) {
      if (!applyServerFieldErrors(form, failure, t("validation.invalid")))
        setError(problemMessage(t, failure));
    }
  });
  return (
    <Section title={t("organization.general.profile")}>
      <form className="flex flex-col gap-4 p-4" noValidate onSubmit={submitWith(submit)}>
        {error ? <Notice variant="danger">{error}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("organization.general.name")} error={form.formState.errors.name?.message}>
            <Input disabled={!editable} {...form.register("name")} />
          </Field>
          <Field
            label={t("organization.general.slug")}
            hint={t("organization.general.slugHint")}
            error={form.formState.errors.slug?.message}
          >
            <Input disabled={!editable} className="font-mono" {...form.register("slug")} />
          </Field>
        </div>
        {editable ? (
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
        ) : null}
      </form>
    </Section>
  );
}

function LogoRow({
  organization,
  editable,
}: {
  organization: { id: string; name: string; logoRef: string | null };
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: organizationKeys.organization(organization.id) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
    await queryClient.invalidateQueries({ queryKey: queryKeys.instanceInfo });
  };

  const upload = async (file: File) => {
    if (!(LOGO_TYPES as readonly string[]).includes(file.type) || file.size > LOGO_MAX_BYTES) {
      toast({ title: t("problems.invalidLogo"), variant: "error" });
      return;
    }
    setBusy(true);
    try {
      const data = await toBase64(file);
      await request(() =>
        api.PUT("/api/v1/organizations/{organizationId}/logo", {
          params: { path: { organizationId: organization.id } },
          body: { contentType: file.type as (typeof LOGO_TYPES)[number], data },
        }),
      );
      await refresh();
      toast({ title: t("organization.general.logoUploaded"), variant: "success" });
    } catch (failure) {
      toast({ title: problemMessage(t, failure), variant: "error" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <SettingRow
      label={t("organization.general.logo")}
      description={t("organization.general.logoHint")}
      control={
        <div className="flex flex-wrap items-center gap-3">
          {organization.logoRef ? (
            <img
              src={organizationLogoUrl({ id: organization.id, logoRef: organization.logoRef })}
              alt={t("brand.organizationLogo", { name: organization.name })}
              className="h-10 w-auto rounded-sm border border-border bg-surface p-1"
            />
          ) : (
            <span className="text-sm text-text-muted">{t("organization.general.noLogo")}</span>
          )}
          {editable ? (
            <>
              <input
                ref={input}
                type="file"
                accept={LOGO_TYPES.join(",")}
                className="sr-only"
                aria-label={t("organization.general.uploadLogo")}
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <Button variant="outline" icon={ImageUp} loading={busy} onClick={() => input.current?.click()}>
                {organization.logoRef
                  ? t("organization.general.replaceLogo")
                  : t("organization.general.uploadLogo")}
              </Button>
              {organization.logoRef ? (
                <Button variant="danger" icon={Trash2} onClick={() => setRemoving(true)}>
                  {t("common.remove")}
                </Button>
              ) : null}
            </>
          ) : null}
          <ConfirmDialog
            open={removing}
            onOpenChange={setRemoving}
            title={t("organization.general.removeLogoTitle")}
            description={t("organization.general.removeLogoDescription")}
            confirmLabel={t("common.remove")}
            cancelLabel={t("common.cancel")}
            destructive
            onConfirm={async () => {
              try {
                await request(() =>
                  api.DELETE("/api/v1/organizations/{organizationId}/logo", {
                    params: { path: { organizationId: organization.id } },
                  }),
                );
                setRemoving(false);
                await refresh();
              } catch (failure) {
                toast({ title: problemMessage(t, failure), variant: "error" });
              }
            }}
          />
        </div>
      }
    />
  );
}

function LeaveSection({ organizationId, name }: { organizationId: string; name: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <Section title={t("organization.general.leaveTitle")}>
      <SettingRow
        label={t("organization.general.leave", { name })}
        description={t("organization.general.leaveDescription")}
        control={
          <Button variant="danger" icon={LogOut} onClick={() => setOpen(true)}>
            {t("organization.general.leaveAction")}
          </Button>
        }
      />
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t("organization.general.leave", { name })}
        description={t("organization.general.leaveConfirm")}
        confirmLabel={t("organization.general.leaveAction")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          try {
            await request(() =>
              api.DELETE("/api/v1/organizations/{organizationId}/membership", {
                params: { path: { organizationId } },
              }),
            );
            setOpen(false);
            await queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
            await navigate({ to: "/settings/preferences" });
          } catch (failure) {
            toast({ title: problemMessage(t, failure), variant: "error" });
          }
        }}
      >
        <Notice variant="warning" title={t("access.losesAccess")}>
          {t("organization.general.leaveImpact", { name })}
        </Notice>
      </ConfirmDialog>
    </Section>
  );
}
