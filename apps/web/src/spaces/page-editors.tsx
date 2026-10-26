import { Tooltip } from "@lunedo/ui";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { PersonAvatar } from "../components/person-avatar.js";
import { useSession } from "../shell/shell-context.js";

const VISIBLE_AVATARS = 3;

export function pageEditorsQuery(pageId: string) {
  return queryOptions({
    queryKey: ["items", pageId, "editors"] as const,
    queryFn: () => request(() => api.GET("/api/v1/pages/{pageId}/editors", { params: { path: { pageId } } })),
  });
}

export function PageEditors({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const editors = useQuery({ ...pageEditorsQuery(pageId), throwOnError: false });
  const others = (editors.data?.editors ?? []).filter((person) => person.id !== session.account?.id);
  if (others.length === 0) return null;
  const nameOf = (person: { name: string | null }) => person.name ?? t("editor.mention.unknown");
  const visible = others.slice(0, VISIBLE_AVATARS);
  const hidden = others.slice(VISIBLE_AVATARS);
  return (
    <ul
      aria-label={t("editor.presence.coEditors", { count: others.length })}
      className="flex items-center -space-x-1 px-1"
    >
      {visible.map((person) => (
        <li key={person.id}>
          <Tooltip content={t("editor.presence.editing", { name: nameOf(person) })}>
            <span className="relative inline-flex rounded-full border-2 border-bg">
              <PersonAvatar
                id={person.id}
                name={nameOf(person)}
                pictureRef={person.pictureRef}
                size="sm"
                decorative
              />
              <span className="sr-only">{t("editor.presence.editing", { name: nameOf(person) })}</span>
              <span
                aria-hidden="true"
                className="absolute -right-1 -bottom-1 inline-flex size-icon-sm items-center justify-center rounded-full border border-bg bg-surface text-text"
              >
                <Pencil className="size-full p-px" />
              </span>
            </span>
          </Tooltip>
        </li>
      ))}
      {hidden.length > 0 ? (
        <li>
          <Tooltip
            content={hidden
              .map((person) => t("editor.presence.editing", { name: nameOf(person) }))
              .join(", ")}
          >
            <span className="inline-flex size-control-sm items-center justify-center rounded-full border-2 border-bg bg-control text-xs font-semibold text-text">
              <span aria-hidden="true">+{hidden.length}</span>
              <span className="sr-only">{t("editor.presence.more", { count: hidden.length })}</span>
            </span>
          </Tooltip>
        </li>
      ) : null}
    </ul>
  );
}
