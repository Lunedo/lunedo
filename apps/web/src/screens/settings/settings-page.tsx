import { BackLink, classNames, FieldLayoutProvider, PageHeader } from "@lunedo/ui";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnThisPage } from "../../spaces/on-this-page.js";

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
  steps = false,
  contents: forceContents = false,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  back?: { label: string; href: string };
  wide?: boolean;
  steps?: boolean;
  contents?: boolean;
  children: ReactNode;
}) {
  useDocumentTitle(title);
  const content = useRef<HTMLDivElement>(null);
  const [contents, setContents] = useState(false);
  return (
    <div
      data-page-width={wide ? "wide" : "narrow"}
      className={classNames(
        "mx-auto flex w-full flex-col gap-8 px-4 pt-6 pb-12 md:px-8",
        wide ? "max-w-page-wide" : contents ? "max-w-page xl:max-w-page-wide" : "max-w-page",
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
      {wide || steps ? (
        <FieldLayoutProvider layout={steps ? "stacked" : "row"}>{children}</FieldLayoutProvider>
      ) : (
        <div
          className={
            contents
              ? "flex flex-col gap-8 xl:grid xl:grid-cols-[minmax(0,1fr)_var(--spacing-sidebar)] xl:items-start xl:gap-10"
              : "contents"
          }
        >
          <div ref={content} className={contents ? "flex min-w-0 flex-col gap-8" : "contents"}>
            <FieldLayoutProvider layout="row">{children}</FieldLayoutProvider>
          </div>
          <OnThisPage
            content={content}
            source="sections"
            {...(forceContents ? { minimum: 2 } : {})}
            onShownChange={setContents}
          />
        </div>
      )}
    </div>
  );
}
