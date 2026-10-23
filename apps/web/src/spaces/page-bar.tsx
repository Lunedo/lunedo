import { type Breadcrumb, Icon, Tooltip, VisuallyHidden } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PersonAvatar } from "../components/person-avatar.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { versionsQuery } from "./content-queries.js";

export function PageBar({
  breadcrumbs,
  sticky = true,
  children,
}: {
  breadcrumbs: Breadcrumb[];
  sticky?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-page-bar=""
      className={`${sticky ? "sticky top-0 z-20" : ""} flex min-h-hit flex-wrap items-center gap-x-3 gap-y-1 bg-bg px-4 py-1`}
    >
      <nav aria-label={t("page.breadcrumbs")} className="min-w-0 flex-1">
        <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-text-muted">
          {breadcrumbs.map((crumb, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a breadcrumb is identified by its position in the path
            <li key={index} className="inline-flex min-w-0 items-center gap-1">
              {index > 0 ? <Icon icon={ChevronRight} size="sm" /> : null}
              {crumb.href ? (
                <Link
                  to={crumb.href as never}
                  className="truncate rounded-sm hover:text-text hover:underline focus-visible:focus-ring"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="truncate">{crumb.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

export function EditInfo({
  pageId,
  editedAt,
  onOpen,
}: {
  pageId: string;
  editedAt: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const versions = useQuery({ ...versionsQuery(pageId), throwOnError: false });
  const latest = versions.data?.[0];
  const editor = latest?.createdBy ?? latest?.contributors[0] ?? null;
  const name = editor?.name ?? null;
  const when = { date: format.date(editedAt), time: format.time(editedAt) };
  const label = name ? t("page.editedBy", { name, ...when }) : t("page.editedOn", when);
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={onOpen}
        className="flex h-control-md items-center gap-2 rounded-md px-2 text-sm text-text-muted hover:bg-hover hover:text-text focus-visible:focus-ring"
      >
        {editor ? <PersonAvatar id={editor.id} name={name ?? ""} size="sm" decorative /> : null}
        <span className="whitespace-nowrap">{format.short(editedAt)}</span>
        <VisuallyHidden>{label}</VisuallyHidden>
      </button>
    </Tooltip>
  );
}
