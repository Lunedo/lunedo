import { classNames, PageHeader } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { organizationQuery } from "../../api/organization-queries.js";
import { organizationLogoUrl } from "../../shell/brand.js";

export function useDocumentTitle(title: string): void {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = title ? t("shell.documentTitle", { title }) : t("brand.name");
  }, [title, t]);
}

export function SettingsPage({
  title,
  description,
  icon,
  actions,
  organizationId,
  breadcrumbs,
  width = "narrow",
  children,
}: {
  title: string;
  description?: string;
  icon: LucideIcon;
  actions?: ReactNode;
  organizationId?: string;
  breadcrumbs?: { label: string; href?: string }[];
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  useDocumentTitle(title);
  const organization = useQuery({
    ...organizationQuery(organizationId ?? ""),
    enabled: Boolean(organizationId),
  });
  const logoRef = organization.data?.logoRef;
  return (
    <div
      data-page-width={width}
      className={classNames(
        "flex w-full flex-col gap-6 px-4 pt-6 pb-12 md:px-8",
        width === "narrow" && "mx-auto max-w-page",
      )}
    >
      <PageHeader
        title={title}
        icon={icon}
        {...(description ? { description } : {})}
        {...(actions ? { actions } : {})}
        {...(breadcrumbs ? { breadcrumbs } : {})}
        {...(organization.data ? { context: organization.data.name } : {})}
        {...(organization.data && logoRef
          ? {
              logo: (
                <img
                  src={organizationLogoUrl({ id: organization.data.id, logoRef })}
                  alt=""
                  className="h-6 w-auto"
                />
              ),
            }
          : {})}
      />
      {children}
    </div>
  );
}
