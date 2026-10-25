import { BackLink, classNames, FieldLayoutProvider, PageHeader } from "@lunedo/ui";
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
  wide = false,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: { label: string; href: string };
  wide?: boolean;
  children: ReactNode;
}) {
  useDocumentTitle(title);
  return (
    <div
      data-page-width={wide ? "wide" : "narrow"}
      className={classNames(
        "mx-auto flex w-full flex-col gap-8 px-4 pt-6 pb-12 md:px-8",
        wide ? "max-w-page-wide" : "max-w-page",
      )}
    >
      <div className="flex flex-col gap-2">
        {back ? (
          <BackLink label={back.label} asChild>
            <Link to={back.href as never} activeOptions={{ exact: true }} />
          </BackLink>
        ) : null}
        <PageHeader
          variant="settings"
          title={title}
          {...(description ? { description } : {})}
          {...(actions ? { actions } : {})}
        />
      </div>
      <FieldLayoutProvider layout="row">{children}</FieldLayoutProvider>
    </div>
  );
}
