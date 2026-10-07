import { PageHeader, Tabs } from "@pagehall/ui";
import { useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";

export function SpaceSettingsPage({
  tab,
  title,
  description,
  icon,
  children,
}: {
  tab: "general" | "permissions";
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
          void navigate({
            to:
              value === "general"
                ? "/spaces/$spaceKey/settings/general"
                : "/spaces/$spaceKey/settings/permissions",
            params: { spaceKey: space.key },
          })
        }
        tabs={[
          { value: "general", label: t("spaces.settings.general") },
          { value: "permissions", label: t("spaces.settings.permissions") },
        ]}
      >
        {children}
      </Tabs>
    </div>
  );
}
