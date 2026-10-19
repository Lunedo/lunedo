import {
  Button,
  Combobox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  focusFirstInvalidSoon,
  Input,
  Section,
  Skeleton,
  Table,
  type TableColumn,
  useToast,
  VisuallyHidden,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, LibraryBig, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { api } from "../../api/client.js";
import { instanceOrganizationsQuery, instanceSettingsQuery } from "../../api/instance-queries.js";
import { request } from "../../api/request.js";
import { AutoSaveTextField } from "../../components/auto-save.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useInstanceSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const domainsKey = ["instance", "portalDomains"] as const;

type PortalDomain = {
  domain: string;
  organizationId: string;
  organizationName: string;
  spaceId: string | null;
  spaceName: string | null;
  createdAt: string;
};

export function InstancePortalsScreen() {
  const { t } = useTranslation();
  return (
    <SettingsPage title={t("portals.title")} description={t("portals.description")} icon={LibraryBig}>
      <AppLinkSection />
      <DomainsSection />
    </SettingsPage>
  );
}

function AppLinkSection() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const settings = useQuery({ ...instanceSettingsQuery, throwOnError: false });
  const mutation = useInstanceSettingMutation();
  const value = settings.data?.find((setting) => setting.key === "portal.appLinkName")?.value;
  return (
    <Section title={t("portals.appLink.title")}>
      <div className="p-4">
        {settings.isPending ? <Skeleton className="h-field w-full" /> : null}
        {settings.isError ? (
          <LoadError
            what={t("portals.appLink.loadFailed")}
            error={settings.error}
            onRetry={() => void settings.refetch()}
          />
        ) : null}
        {settings.data ? (
          <AutoSaveTextField
            label={t("portals.appLink.label")}
            hint={t("portals.appLink.hint")}
            value={typeof value === "string" ? value : ""}
            schema={z.string().max(60)}
            disabled={!state.can("instance.settings.manage")}
            onSave={(next) => mutation.mutateAsync({ key: "portal.appLinkName", change: { value: next } })}
          />
        ) : null}
      </div>
    </Section>
  );
}

function DomainsSection() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = state.can("instance.settings.manage");
  const domains = useQuery({
    queryKey: domainsKey,
    queryFn: () => request(() => api.GET("/api/v1/instance/portal-domains")),
    enabled: canManage,
    throwOnError: false,
  });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PortalDomain | null>(null);
  const columns: TableColumn<PortalDomain>[] = [
    {
      key: "domain",
      header: t("portals.domains.domain"),
      cell: (row) => <span className="font-mono">{row.domain}</span>,
    },
    { key: "organization", header: t("portals.domains.organization"), cell: (row) => row.organizationName },
    {
      key: "usedBy",
      header: t("portals.domains.usedBy"),
      cell: (row) => row.spaceName ?? <span className="text-text-muted">{t("portals.domains.unused")}</span>,
    },
    {
      key: "actions",
      header: <VisuallyHidden>{t("portals.domains.actions")}</VisuallyHidden>,
      align: "end",
      cell: (row) => (
        <Button variant="outline" size="sm" onClick={() => setRemoving(row)}>
          {t("portals.domains.remove")}
        </Button>
      ),
    },
  ];
  return (
    <Section
      title={t("portals.domains.title")}
      {...(canManage
        ? {
            actions: (
              <Button variant="secondary" size="sm" icon={Plus} onClick={() => setAdding(true)}>
                {t("portals.domains.allow")}
              </Button>
            ),
          }
        : {})}
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-text-muted">{t("portals.domains.description")}</p>
        {!canManage ? <p className="text-sm text-text-muted">{t("portals.domains.adminsOnly")}</p> : null}
        {domains.isPending && canManage ? <Skeleton className="h-field w-full" /> : null}
        {domains.isError ? (
          <LoadError
            what={t("portals.domains.loadFailed")}
            error={domains.error}
            onRetry={() => void domains.refetch()}
          />
        ) : null}
        {domains.data && domains.data.length === 0 ? (
          <EmptyState
            icon={Globe}
            title={t("portals.domains.emptyTitle")}
            description={t("portals.domains.emptyDescription")}
          />
        ) : null}
        {domains.data && domains.data.length > 0 ? (
          <Table
            caption={t("portals.domains.title")}
            columns={columns}
            rows={domains.data}
            rowKey={(row) => row.domain}
          />
        ) : null}
      </div>
      <AllowDomainDialog open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("portals.domains.removeTitle", { domain: removing?.domain ?? "" })}
        description={
          removing?.spaceName
            ? t("portals.domains.removeUsed", { space: removing.spaceName })
            : t("portals.domains.removeUnused")
        }
        confirmLabel={t("portals.domains.removeConfirm", { domain: removing?.domain ?? "" })}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/instance/portal-domains/{domain}", {
                params: { path: { domain: removing.domain } },
              }),
            );
            await queryClient.invalidateQueries({ queryKey: domainsKey });
            toast({ title: t("portals.domains.removed", { domain: removing.domain }), variant: "success" });
            setRemoving(null);
          } catch (failure) {
            toast({
              title: t("portals.domains.removeFailed"),
              description: problemMessage(t, failure),
              variant: "error",
            });
          }
        }}
      />
    </Section>
  );
}

function AllowDomainDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const organizations = useQuery({ ...instanceOrganizationsQuery, enabled: open, throwOnError: false });
  const [domain, setDomain] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ domain?: string; organization?: string }>({});
  const [saving, setSaving] = useState(false);
  const close = () => {
    setDomain("");
    setOrganizationId(null);
    setErrors({});
    onOpenChange(false);
  };
  const submit = async () => {
    const value = domain.trim().toLowerCase().replace(/\.$/, "");
    const next: { domain?: string; organization?: string } = {};
    if (!DOMAIN.test(value)) next.domain = t("portals.domains.domainInvalid");
    if (!organizationId) next.organization = t("portals.domains.organizationMissing");
    setErrors(next);
    if (next.domain || next.organization || !organizationId) {
      focusFirstInvalidSoon();
      return;
    }
    setSaving(true);
    try {
      await request(() =>
        api.POST("/api/v1/instance/portal-domains", { body: { domain: value, organizationId } }),
      );
      await queryClient.invalidateQueries({ queryKey: domainsKey });
      toast({ title: t("portals.domains.allowed", { domain: value }), variant: "success" });
      close();
    } catch (failure) {
      setErrors({ domain: problemMessage(t, failure) });
      focusFirstInvalidSoon();
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("portals.domains.allowTitle")}
      description={t("portals.domains.allowDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void submit()}>
            {t("portals.domains.allow")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label={t("portals.domains.domain")}
          hint={t("portals.domains.domainHint")}
          {...(errors.domain ? { error: errors.domain } : {})}
        >
          <Input
            value={domain}
            className="font-mono"
            placeholder={t("portals.domains.domainPlaceholder")}
            onChange={(event) => setDomain(event.target.value)}
          />
        </Field>
        <Field
          label={t("portals.domains.organization")}
          {...(errors.organization ? { error: errors.organization } : {})}
        >
          <Combobox
            value={organizationId}
            items={(organizations.data ?? []).map((organization) => ({
              value: organization.id,
              label: organization.name,
            }))}
            placeholder={t("portals.domains.organizationPlaceholder")}
            invalid={errors.organization !== undefined}
            onValueChange={(value) => setOrganizationId(value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
