import type { EmbedService } from "@lunedo/editor-schema";
import { Section, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { instanceSettingsQuery } from "../../api/instance-queries.js";
import { InstanceEmbedAllowlist } from "../../embeds/embed-allowlist.js";
import { LoadError } from "../../errors/failure.js";
import { useInstanceSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

function EmbedSection() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const settings = useQuery({ ...instanceSettingsQuery, throwOnError: false });
  const mutation = useInstanceSettingMutation();
  const value = settings.data?.find((setting) => setting.key === "embeds.services")?.value;
  return (
    <Section title={t("embeds.allowlist.title")}>
      <div className="p-4">
        {settings.isPending ? <Skeleton className="h-32 w-full" /> : null}
        {settings.isError ? (
          <LoadError
            what={t("embeds.allowlist.loadFailed")}
            error={settings.error}
            onRetry={() => void settings.refetch()}
          />
        ) : null}
        {settings.data ? (
          <InstanceEmbedAllowlist
            services={Array.isArray(value) ? (value as EmbedService[]) : []}
            canManage={state.can("instance.settings.manage")}
            onSave={(services) =>
              mutation.mutateAsync({ key: "embeds.services", change: { value: services } })
            }
          />
        ) : null}
      </div>
    </Section>
  );
}

export function InstanceEmbedsScreen() {
  const { t } = useTranslation();
  return (
    <SettingsPage title={t("embeds.settings.title")} description={t("embeds.settings.description")}>
      <EmbedSection />
    </SettingsPage>
  );
}
