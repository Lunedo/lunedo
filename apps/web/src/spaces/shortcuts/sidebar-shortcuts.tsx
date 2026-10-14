import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { ExternalLink, Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { shortcutHref, shortcutsQuery } from "./shortcut-queries.js";

export function SidebarShortcuts({ spaceId }: { spaceId: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const shortcuts = useQuery({ ...shortcutsQuery(spaceId), throwOnError: false });
  const entries = (shortcuts.data ?? []).flatMap((shortcut) => {
    const target = shortcutHref(shortcut);
    return target ? [{ shortcut, target }] : [];
  });
  if (entries.length === 0) return null;
  const rowClass = "flex h-row min-w-0 items-center gap-2 rounded-sm px-2 focus-visible:focus-ring";
  return (
    <nav aria-labelledby={`shortcuts-${spaceId}`} className="flex flex-col">
      <h2
        id={`shortcuts-${spaceId}`}
        className="px-2 pt-4 pb-1 text-xs font-semibold tracking-label text-text-muted uppercase"
      >
        {t("spaceShortcuts.title")}
      </h2>
      <ul className="flex flex-col gap-px">
        {entries.map(({ shortcut, target }) => {
          const active = !target.external && location.pathname === target.href.split("#")[0];
          return (
            <li key={shortcut.id}>
              {target.external ? (
                <a
                  href={target.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${shortcut.label} · ${target.href}`}
                  className={`${rowClass} hover:bg-hover`}
                >
                  <ExternalLink aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
                  <span className="truncate">{shortcut.label}</span>
                  <span className="sr-only"> {t("common.opensInNewTab")}</span>
                </a>
              ) : (
                <Link
                  to={target.href}
                  title={shortcut.label}
                  aria-current={active ? "page" : undefined}
                  className={`${rowClass} ${active ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
                >
                  <Link2 aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
                  <span className="truncate">{shortcut.label}</span>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
