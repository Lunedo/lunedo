import { IconButton, Popover, Tooltip, useToast } from "@pagehall/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, SmilePlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { EmojiPicker } from "../editor/emoji-picker.js";
import { problemMessage } from "../errors/problem-message.js";
import { collaborationKeys, type ReactionSummary, reactionsQuery } from "./queries.js";

export const QUICK_REACTIONS = ["👍", "❤️", "🎉", "😄", "👀", "🙏"] as const;

const NAMES_SHOWN = 5;

function useNames() {
  const { t } = useTranslation();
  return (reaction: ReactionSummary) => {
    const names = reaction.people.slice(0, NAMES_SHOWN).map((person) => person.name);
    const rest = reaction.count - names.length;
    return rest > 0
      ? t("reactions.namesAndMore", { names: names.join(", "), count: rest })
      : names.join(", ");
  };
}

export function ReactionBar({
  reactions,
  canReact,
  onToggle,
  label,
}: {
  reactions: readonly ReactionSummary[];
  canReact: boolean;
  onToggle: (emoji: string, add: boolean) => void;
  label: string;
}) {
  const { t } = useTranslation();
  const names = useNames();
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState(false);
  const add = (emoji: string) => {
    setAdding(false);
    if (!reactions.some((reaction) => reaction.emoji === emoji && reaction.reacted)) onToggle(emoji, true);
  };
  if (!canReact && reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <ul aria-label={label} className="flex flex-wrap items-center gap-1">
        {reactions.map((reaction) => (
          <li key={reaction.emoji}>
            <Tooltip content={names(reaction)}>
              {canReact ? (
                <button
                  type="button"
                  aria-pressed={reaction.reacted}
                  aria-label={t("reactions.reactionLabel", {
                    emoji: reaction.emoji,
                    count: reaction.count,
                    names: names(reaction),
                  })}
                  onClick={() => onToggle(reaction.emoji, !reaction.reacted)}
                  className="inline-flex min-h-hit min-w-hit items-center justify-center gap-1 rounded-full border border-border px-2 text-sm hover:bg-hover focus-visible:focus-ring aria-pressed:border-accent aria-pressed:bg-accent-soft"
                >
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span className="tabular-nums">{reaction.count}</span>
                </button>
              ) : (
                <span
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: the reaction can be focused to show who reacted
                  tabIndex={0}
                  className="inline-flex min-h-hit items-center gap-1 rounded-full border border-border px-2 text-sm focus-visible:focus-ring"
                >
                  <span className="sr-only">
                    {t("reactions.reactionLabel", {
                      emoji: reaction.emoji,
                      count: reaction.count,
                      names: names(reaction),
                    })}
                  </span>
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span aria-hidden="true" className="tabular-nums">
                    {reaction.count}
                  </span>
                </span>
              )}
            </Tooltip>
          </li>
        ))}
      </ul>
      {canReact ? (
        <Popover
          open={adding}
          onOpenChange={setAdding}
          label={t("reactions.add")}
          trigger={<IconButton label={t("reactions.add")} icon={SmilePlus} size="sm" />}
        >
          <div className="flex items-center gap-1 p-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={t("reactions.reactWith", { emoji })}
                onClick={() => add(emoji)}
                className="inline-flex size-hit items-center justify-center rounded-md text-lg hover:bg-hover focus-visible:focus-ring"
              >
                {emoji}
              </button>
            ))}
            <IconButton
              label={t("reactions.allEmoji")}
              icon={MoreHorizontal}
              size="sm"
              onClick={() => {
                setAdding(false);
                setPicking(true);
              }}
            />
          </div>
        </Popover>
      ) : null}
      <EmojiPicker open={picking} onOpenChange={setPicking} onSelect={(emoji) => add(emoji)} />
    </div>
  );
}

export function useReactionToggle(target: { itemId: string } | { commentId: string; itemId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ emoji, add }: { emoji: string; add: boolean }) => {
      if ("commentId" in target) {
        const params = { params: { path: { commentId: target.commentId, emoji } } };
        return request(() =>
          add
            ? api.PUT("/api/v1/comments/{commentId}/reactions/{emoji}", params)
            : api.DELETE("/api/v1/comments/{commentId}/reactions/{emoji}", params),
        );
      }
      const params = { params: { path: { pageId: target.itemId, emoji } } };
      return request(() =>
        add
          ? api.PUT("/api/v1/pages/{pageId}/reactions/{emoji}", params)
          : api.DELETE("/api/v1/pages/{pageId}/reactions/{emoji}", params),
      );
    },
    onError: (error) =>
      toast({ variant: "error", title: t("reactions.failed"), description: problemMessage(t, error) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.reactions(target.itemId) });
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.comments(target.itemId) });
    },
  });
}

export function PageReactions({ itemId, canReact }: { itemId: string; canReact: boolean }) {
  const { t } = useTranslation();
  const reactions = useQuery(reactionsQuery(itemId));
  const toggle = useReactionToggle({ itemId });
  if (!reactions.data?.enabled) return null;
  return (
    <ReactionBar
      reactions={reactions.data.reactions}
      canReact={canReact}
      label={t("reactions.pageLabel")}
      onToggle={(emoji, add) => toggle.mutate({ emoji, add })}
    />
  );
}
