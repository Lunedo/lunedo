import { PageHeader, Tabs } from "@lunedo/ui";
import { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isKnowledgeBase } from "../../knowledge-bases/queries.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";

export type SpaceSettingsTab =
  | "general"
  | "permissions"
  | "access"
  | "content"
  | "status"
  | "shortcuts"
  | "chat"
  | "templates"
  | "export"
  | "visibility"
  | "categories"
  | "articleTemplates"
  | "reviews"
  | "address"
  | "appearance"
  | "languages"
  | "portalAccounts";

const TAB_PATHS = {
  general: "/spaces/$spaceKey/settings/general",
  permissions: "/spaces/$spaceKey/settings/permissions",
  access: "/spaces/$spaceKey/settings/access",
  content: "/spaces/$spaceKey/settings/content",
  status: "/spaces/$spaceKey/settings/status",
  shortcuts: "/spaces/$spaceKey/settings/shortcuts",
  chat: "/spaces/$spaceKey/settings/chat",
  templates: "/spaces/$spaceKey/settings/templates",
  export: "/spaces/$spaceKey/settings/export",
  visibility: "/spaces/$spaceKey/settings/visibility",
  categories: "/spaces/$spaceKey/settings/categories",
  articleTemplates: "/spaces/$spaceKey/settings/article-templates",
  reviews: "/spaces/$spaceKey/settings/reviews",
  address: "/spaces/$spaceKey/settings/address",
  appearance: "/spaces/$spaceKey/settings/appearance",
  languages: "/spaces/$spaceKey/settings/languages",
  portalAccounts: "/spaces/$spaceKey/settings/portal-accounts",
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
        tabs={
          isKnowledgeBase(space)
            ? [
                { value: "general", label: t("spaces.settings.general") },
                { value: "address", label: t("knowledgeBase.settings.address") },
                { value: "appearance", label: t("knowledgeBase.settings.appearance") },
                { value: "visibility", label: t("knowledgeBase.settings.visibility") },
                { value: "portalAccounts", label: t("portalAccounts.tab") },
                { value: "languages", label: t("knowledgeBase.languages.tab") },
                { value: "permissions", label: t("spaces.settings.permissions") },
                { value: "access", label: t("spaces.access.tab") },
                { value: "categories", label: t("knowledgeBase.settings.categories") },
                { value: "articleTemplates", label: t("knowledgeBase.settings.articleTemplates") },
                { value: "reviews", label: t("reviews.settings.tab") },
                { value: "templates", label: t("templates.title") },
                { value: "content", label: t("content.title") },
                { value: "status", label: t("pageStatus.settingsTitle") },
                { value: "shortcuts", label: t("spaceShortcuts.title") },
                { value: "chat", label: t("chatChannels.title") },
                { value: "export", label: t("exports.settings.tab") },
              ]
            : [
                { value: "general", label: t("spaces.settings.general") },
                { value: "permissions", label: t("spaces.settings.permissions") },
                { value: "access", label: t("spaces.access.tab") },
                { value: "content", label: t("content.title") },
                { value: "status", label: t("pageStatus.settingsTitle") },
                { value: "shortcuts", label: t("spaceShortcuts.title") },
                { value: "chat", label: t("chatChannels.title") },
                { value: "templates", label: t("templates.title") },
                { value: "export", label: t("exports.settings.tab") },
              ]
        }
      >
        {children}
      </Tabs>
    </div>
  );
}
