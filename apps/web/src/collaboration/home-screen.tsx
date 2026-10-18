import { EmptyState, PageHeader, Section, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AtSign, Clock, Layers, ListChecks, Newspaper, Share2, Star, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { OneOnOnes, UpcomingMeetings } from "../meetings/home-sections.js";
import { oneOnOnesQuery, upcomingQuery } from "../meetings/queries.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { sharedWithMeQuery } from "../sharing/sharing-api.js";
import { useSession } from "../shell/shell-context.js";
import { itemIcon } from "../spaces/item-icons.js";
import { itemHref } from "../spaces/item-paths.js";
import { postHref } from "./blog/blog-list.js";
import { type ContentReference, homeQuery } from "./queries.js";

function ReferenceLink({
  item,
  meta,
}: {
  item: Pick<ContentReference, "id" | "kind" | "title" | "spaceKey" | "spaceName">;
  meta?: string;
}) {
  const href = itemHref({ id: item.id, kind: item.kind, title: item.title, link: null }, item.spaceKey);
  const Icon = itemIcon(item.kind);
  if (!href) return null;
  return (
    <Link
      to={href}
      className="flex min-h-hit items-center gap-3 rounded-sm px-2 py-1 hover:bg-hover focus-visible:focus-ring"
    >
      <Icon aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
      <span className="min-w-0 flex-1 truncate" title={item.title}>
        {item.title}
      </span>
      <span className="hidden shrink-0 truncate text-sm text-text-muted sm:block" title={item.spaceName}>
        {meta ?? item.spaceName}
      </span>
    </Link>
  );
}

function SharedWithYou() {
  const { t } = useTranslation();
  const format = useFormat();
  const shared = useQuery({ ...sharedWithMeQuery(), throwOnError: false });
  return (
    <Section title={t("home.shared")} icon={Share2}>
      {shared.isPending ? <Skeleton className="h-12 w-full" /> : null}
      {shared.isError ? (
        <LoadError what={t("home.shared")} error={shared.error} onRetry={() => shared.refetch()} />
      ) : null}
      {shared.data?.length === 0 ? <Empty text={t("home.noShared")} /> : null}
      {shared.data && shared.data.length > 0 ? (
        <ul className="flex flex-col">
          {shared.data.slice(0, 8).map((entry) => (
            <li key={entry.itemId}>
              <ReferenceLink
                item={{
                  id: entry.itemId,
                  kind: entry.kind === "blogPost" ? "blogPost" : "page",
                  title: entry.title,
                  spaceKey: entry.spaceKey,
                  spaceName: entry.spaceName,
                }}
                meta={t("home.sharedMeta", {
                  name: entry.sharedBy?.name ?? t("files.someone"),
                  when: format.relative(entry.sharedAt),
                })}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-2 py-2 text-sm text-text-muted">{text}</p>;
}

export function HomeScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const session = useSession();
  const home = useQuery(homeQuery());
  const upcoming = useQuery({ ...upcomingQuery(), throwOnError: false });
  const oneOnOnes = useQuery({ ...oneOnOnesQuery(), throwOnError: false });
  useDocumentTitle(t("home.title"));
  const name = session.account?.name ?? "";
  return (
    <main
      id="main"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader title={t("home.title")} description={t("home.greeting", { name })} icon={Sun} />
        {home.isPending ? (
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-field w-full" />
            <Skeleton className="h-field w-full" />
          </div>
        ) : null}
        {home.isError ? (
          <LoadError what={t("home.loadFailed")} error={home.error} onRetry={() => home.refetch()} />
        ) : null}
        {home.data ? (
          <div className="grid gap-6 md:grid-cols-2">
            <UpcomingMeetings />
            <OneOnOnes />
            <Section title={t("home.tasks")} icon={ListChecks}>
              <div className="flex flex-col gap-2">
                {home.data.tasks.length === 0 ? (
                  <Empty text={t("home.noTasks")} />
                ) : (
                  <ul className="flex flex-col">
                    {home.data.tasks.map((task) => (
                      <li key={task.id}>
                        <Link
                          to={
                            itemHref(
                              { id: task.item.id, kind: task.item.kind, title: task.item.title, link: null },
                              task.item.spaceKey,
                            ) ?? "/"
                          }
                          className="flex min-h-hit items-center gap-3 rounded-sm px-2 py-1 hover:bg-hover focus-visible:focus-ring"
                        >
                          <ListChecks aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
                          <span className="min-w-0 flex-1 truncate" title={task.text}>
                            {task.text || t("tasks.untitled")}
                          </span>
                          <span
                            className={`shrink-0 text-sm ${task.overdue ? "font-semibold text-danger" : "text-text-muted"}`}
                          >
                            {task.dueDate
                              ? task.overdue
                                ? t("tasks.overdueSince", { date: format.date(`${task.dueDate}T12:00:00Z`) })
                                : t("tasks.dueOn", { date: format.date(`${task.dueDate}T12:00:00Z`) })
                              : t("tasks.noDueDate")}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  to="/tasks"
                  className="inline-flex min-h-hit items-center self-start px-2 text-sm text-accent hover:underline focus-visible:focus-ring"
                >
                  {t("home.allTasks")}
                </Link>
              </div>
            </Section>
            <Section title={t("home.mentions")} icon={AtSign}>
              {home.data.mentions.length === 0 ? (
                <Empty text={t("home.noMentions")} />
              ) : (
                <ul className="flex flex-col">
                  {home.data.mentions.map((mention) => (
                    <li key={mention.id}>
                      <ReferenceLink
                        item={mention.item}
                        meta={
                          mention.actor
                            ? t("home.mentionedBy", {
                                name: mention.actor.name,
                                when: format.relative(mention.at),
                              })
                            : format.relative(mention.at)
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={t("home.recent")} icon={Clock}>
              {home.data.recent.length === 0 ? (
                <Empty text={t("home.noRecent")} />
              ) : (
                <ul className="flex flex-col">
                  {home.data.recent.map((item) => (
                    <li key={item.id}>
                      <ReferenceLink item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title={t("home.starred")} icon={Star}>
              {home.data.starred.items.length === 0 && home.data.starred.spaces.length === 0 ? (
                <Empty text={t("home.noStarred")} />
              ) : (
                <ul className="flex flex-col">
                  {home.data.starred.spaces.map((space) => (
                    <li key={space.id}>
                      <Link
                        to="/spaces/$spaceKey"
                        params={{ spaceKey: space.key }}
                        className="flex min-h-hit items-center gap-3 rounded-sm px-2 py-1 hover:bg-hover focus-visible:focus-ring"
                      >
                        <Layers aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
                        <span className="min-w-0 flex-1 truncate">
                          {space.name || t("spaces.personal.label")}
                        </span>
                      </Link>
                    </li>
                  ))}
                  {home.data.starred.items.map((item) => (
                    <li key={item.id}>
                      <ReferenceLink item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <SharedWithYou />
            <div className="md:col-span-2">
              <Section title={t("home.posts")} icon={Newspaper}>
                <div className="flex flex-col gap-2">
                  {home.data.posts.length === 0 ? (
                    <Empty text={t("home.noPosts")} />
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {home.data.posts.map((post) => (
                        <li key={post.id}>
                          <Link
                            to={postHref(post)}
                            className="flex flex-col gap-1 rounded-sm px-2 py-2 hover:bg-hover focus-visible:focus-ring"
                          >
                            <span className="font-semibold">{post.title}</span>
                            <span className="text-sm text-text-muted">
                              {post.spaceName} · {post.publishedAt ? format.date(post.publishedAt) : ""}
                            </span>
                            {post.excerpt ? <span className="text-text">{post.excerpt}</span> : null}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    to="/blog"
                    className="inline-flex min-h-hit items-center self-start px-2 text-sm text-accent hover:underline focus-visible:focus-ring"
                  >
                    {t("home.allPosts")}
                  </Link>
                </div>
              </Section>
            </div>
          </div>
        ) : null}
        {home.data &&
        home.data.recent.length === 0 &&
        home.data.tasks.length === 0 &&
        home.data.mentions.length === 0 &&
        home.data.posts.length === 0 &&
        home.data.starred.items.length === 0 &&
        upcoming.data?.length === 0 &&
        oneOnOnes.data?.length === 0 ? (
          <EmptyState
            icon={Layers}
            title={t("home.firstUseTitle")}
            description={t("home.firstUseDescription")}
            action={
              <Link to="/spaces" className="text-accent underline focus-visible:focus-ring">
                {t("home.openSpaces")}
              </Link>
            }
          />
        ) : null}
      </div>
    </main>
  );
}
