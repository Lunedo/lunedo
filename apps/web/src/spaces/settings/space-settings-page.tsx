import { PageHeader, Tabs } from "@pagehall/ui";
import { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";

export type SpaceSettingsTab = "general" | "permissions" | "access" | "content" | "status" | "templates";

const TAB_PATHS = {
  general: "/spaces/$spaceKey/settings/general",
  permissions: "/spaces/$spaceKey/settings/permissions",
  access: "/spaces/$spaceKey/settings/access",
  content: "/spaces/$spaceKey/settings/content",
  status: "/spaces/$spaceKey/settings/status",
  templates: "/spaces/$spaceKey/settings/templates",
} as const;

export function SpaceSettingsPage({
  tab,
  title,
  description,
  icon,
  children,
}: {
  tab: SpaceSettingsTab;
  title: string;
  description: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const navigate = useNavigate();
  const name = spaceDisplayName(t, space);
  useDocumentTitle(`${title} · ${name}`);
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={title}
        description={description}
        icon={icon}
        breadcrumbs={[{ label: name, href: `/spaces/${space.key}` }, { label: t("spaces.settings.title") }]}
      />
      <Tabs
        label={t("spaces.settings.title")}
        value={tab}
        onValueChange={(value) =>
          void navigate({ to: TAB_PATHS[value as SpaceSettingsTab], params: { spaceKey: space.key } })
        }
        tabs={[
          { value: "general", label: t("spaces.settings.general") },
          { value: "permissions", label: t("spaces.settings.permissions") },
          { value: "access", label: t("spaces.access.tab") },
          { value: "content", label: t("content.title") },
          { value: "status", label: t("pageStatus.settingsTitle") },
          { value: "templates", label: t("templates.title") },
        ]}
      >
        {children}
      </Tabs>
    </div>
  );
}
