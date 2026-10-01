import { Section, useToast } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { organizationQuery, organizationSettingsQuery } from "../../api/organization-queries.js";
import { SettingsList } from "../../components/settings-list.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useOrganizationSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/security");

export const ORGANIZATION_SIGN_IN_KEYS = [
  "auth.twoFactorRequired",
  "auth.passwordMinLength",
  "auth.reauthenticationMinutes",
  "auth.sessionIdleTimeoutMinutes",
  "auth.sessionLifetimeMinutes",
  "auth.maxSessionsPerAccount",
];

export const ORGANIZATION_TOKEN_KEYS = ["apiTokens.maxLifetimeDays"];

export function OrganizationSecurityScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const { toast } = useToast();
  const organization = useQuery(organizationQuery(organizationId));
  const settings = useQuery(organizationSettingsQuery(organizationId));
  const mutation = useOrganizationSettingMutation(organizationId);
  const onChange = async (key: string, change: Parameters<typeof mutation.mutateAsync>[0]["change"]) => {
    await mutation.mutateAsync({ key, change }).catch((error: unknown) => {
      toast({ title: problemMessage(t, error), variant: "error" });
    });
  };
  const name = organization.data?.name ?? "";
  return (
    <SettingsPage
      title={t("organization.security.title")}
      description={t("organization.security.description", { name })}
      icon={LockKeyhole}
      organizationId={organizationId}
    >
      <Section title={t("organization.security.signIn")}>
        <SettingsList
          settings={settings.data}
          keys={ORGANIZATION_SIGN_IN_KEYS}
          level="organization"
          organizationName={name}
          canManage={() => state.can("organization.signIn.manage")}
          onChange={onChange}
        />
      </Section>
      <Section title={t("organization.security.apiTokens")}>
        <SettingsList
          settings={settings.data}
          keys={ORGANIZATION_TOKEN_KEYS}
          level="organization"
          organizationName={name}
          canManage={() => state.can("organization.settings.manage")}
          onChange={onChange}
        />
      </Section>
    </SettingsPage>
  );
}
