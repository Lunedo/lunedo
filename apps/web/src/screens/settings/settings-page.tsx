import { BackLink, classNames, PageHeader } from "@lunedo/ui";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";

export function useDocumentTitle(title: string): void {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = title ? t("shell.documentTitle", { title }) : t("brand.name");
  }, [title, t]);
}

export function SettingsPage({
  title,
  description,
  actions,
  back,
  width = "narrow",
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: { label: string; href: string };
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <div
      data-page-width={width}
      className={classNames(
        "flex w-full flex-col gap-8 px-4 pt-6 pb-12 md:px-8",
        width === "narrow" && "mx-auto max-w-page",
      )}
    >
      <div className="flex flex-col gap-2">
        {back ? (
          <BackLink label={back.label} asChild>
            <Link to={back.href as never} />
          </BackLink>
        ) : null}
        <PageHeader
          variant="settings"
          title={title}
          {...(description ? { description } : {})}
          {...(actions ? { actions } : {})}
        />
      </div>
      {children}
    </div>
  );
}
