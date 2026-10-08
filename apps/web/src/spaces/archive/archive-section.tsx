import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, ChevronRight, FileText, Folder } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { archiveQuery } from "../content-queries.js";
import { itemHref } from "../item-paths.js";
import type { SpaceWithRole } from "../space-queries.js";

export function ArchiveSection({ space, currentId }: { space: SpaceWithRole; currentId: string | null }) {
  const { t } = useTranslation();
  const archive = useQuery({ ...archiveQuery(space.id), throwOnError: false });
  const [open, setOpen] = useState(false);
  const items = archive.data ?? [];
  if (items.length === 0) return null;
  const panelId = `archive-${space.id}`;
  return (
    <div className="flex flex-col gap-px pt-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex h-row items-center gap-2 rounded-sm px-2 text-start focus-visible:focus-ring hover:bg-hover"
      >
        <ChevronRight
          aria-hidden="true"
          className={`size-icon-sm shrink-0 text-text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        <Archive aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-label text-text-muted uppercase">
          {t("archive.sectionTitle")}
        </span>
        <span className="text-xs text-text-muted tabular-nums">{items.length}</span>
      </button>
      {open ? (
        <ul id={panelId} className="flex flex-col gap-px">
          {items.map((item) => {
            const href = itemHref({ id: item.id, kind: item.kind, title: item.title, link: null }, space.key);
            const Icon = item.kind === "folder" ? Folder : FileText;
            const current = item.id === currentId;
            return (
              <li key={item.id}>
                {href ? (
                  <Link
                    to={href}
                    aria-current={current ? "page" : undefined}
                    title={item.title}
                    className={`flex h-row items-center gap-2 rounded-sm pr-2 pl-8 focus-visible:focus-ring ${current ? "bg-selected font-semibold text-selected-text" : "text-text-muted hover:bg-hover"}`}
                  >
                    <Icon aria-hidden="true" className="size-icon shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
