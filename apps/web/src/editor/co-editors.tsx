import { Tooltip } from "@lunedo/ui";
import { Pencil } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type PictureOf, PresenceAvatar, type PresenceUser } from "./presence.js";

const VISIBLE_AVATARS = 3;

export function CoEditors({ others, pictureOf }: { others: PresenceUser[]; pictureOf?: PictureOf }) {
  const { t } = useTranslation();
  if (others.length === 0) return null;
  const visible = others.slice(0, VISIBLE_AVATARS);
  const hidden = others.slice(VISIBLE_AVATARS);
  return (
    <ul
      aria-label={t("editor.presence.coEditors", { count: others.length })}
      className="flex items-center gap-2"
    >
      {visible.map((user) => (
        <li key={user.id}>
          <Tooltip content={t("editor.presence.editing", { name: user.name })}>
            <PresenceAvatar user={user} pictureRef={pictureOf?.(user.id)}>
              <span className="sr-only">{t("editor.presence.editing", { name: user.name })}</span>
              <span
                aria-hidden="true"
                className="absolute -right-1 -bottom-1 inline-flex size-icon-sm items-center justify-center rounded-full border border-surface bg-surface text-text"
              >
                <Pencil className="size-full p-px" />
              </span>
            </PresenceAvatar>
          </Tooltip>
        </li>
      ))}
      {hidden.length > 0 ? (
        <li>
          <Tooltip
            content={hidden.map((user) => t("editor.presence.editing", { name: user.name })).join(", ")}
          >
            <span className="inline-flex size-control-sm items-center justify-center rounded-full border-2 border-surface bg-control text-xs font-semibold text-text">
              <span aria-hidden="true">+{hidden.length}</span>
              <span className="sr-only">{t("editor.presence.more", { count: hidden.length })}</span>
            </span>
          </Tooltip>
        </li>
      ) : null}
    </ul>
  );
}
