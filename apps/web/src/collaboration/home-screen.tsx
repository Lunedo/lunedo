import { Button, EmptyState, PageHeader, Section, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Layers, ListChecks } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { DueForReview } from "../knowledge-bases/reviews/home-reviews.js";
import { OneOnOnes, UpcomingMeetings } from "../meetings/home-sections.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { sharedWithMeQuery } from "../sharing/sharing-api.js";
import { WithoutOrganizationNotice } from "../shell/app-shell.js";
import { useShell } from "../shell/shell.js";
import { useCan, useOrganizationState } from "../shell/shell-context.js";
import { CreateSpaceDialog } from "../spaces/create-space-dialog.js";
import { itemIcon } from "../spaces/item-icons.js";
import { itemHref } from "../spaces/item-paths.js";
import { SpaceBadge } from "../spaces/space-badge.js";
import { postHref } from "./blog/blog-list.js";
import { HomeEmpty, HomeRow } from "./home-rows.js";
import { homeQuery } from "./queries.js";

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to as never}
      className="rounded-sm text-sm text-accent hover:underline focus-visible:focus-ring"
    >
      {children}
    </Link>
  );
}

function ItemIcon({ kind }: { kind: string }) {
  const Icon = itemIcon(kind);
  return <Icon aria-hidden="true" className="size-icon-md" />;
}

function SharedWithYou() {
  const { t } = useTranslation();
  const format = useFormat();
  const shared = useQuery({ ...sharedWithMeQuery(), throwOnError: false });
  return (
    <Section title={t("home.shared")}>
      {shared.isPending ? <Skeleton className="my-2 h-field w-full" /> : null}
      {shared.isError ? (
        <LoadError what={t("home.shared")} error={shared.error} onRetry={() => shared.refetch()} />
      ) : null}
      {shared.data?.length === 0 ? <HomeEmpty text={t("home.noShared")} /> : null}
      {shared.data?.slice(0, 8).map((entry) => {
        const kind = entry.kind === "blogPost" ? "blogPost" : "page";
        const href = itemHref({ id: entry.itemId, kind, title: entry.title, link: null }, entry.spaceKey);
        return href ? (
          <HomeRow
            key={entry.itemId}
            to={href}
            leading={<ItemIcon kind={kind} />}
            title={entry.title}
            meta={`${t("home.sharedMeta", {
              name: entry.sharedBy?.name ?? t("files.someone"),
              when: format.short(entry.sharedAt),
            })} · ${entry.spaceName}`}
          />
        ) : null;
      })}
    </Section>
  );
}

function useHasSpaces() {
  const spaces = useQuery({
    queryKey: ["spaces", "any"],
    queryFn: () => request(() => api.GET("/api/v1/spaces", { params: { query: { limit: 1 } } })),
    throwOnError: false,
  });
  if (spaces.isError) return true;
  return spaces.data ? spaces.data.items.length > 0 : null;
}

function FirstStart() {
  const { t } = useTranslation();
  const canCreate = useCan("organization.spaces.create");
  const [creating, setCreating] = useState(false);
  return (
    <>
      <EmptyState
        icon={Layers}
        title={t("home.firstUseTitle")}
        description={t("home.firstUseDescription")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" asChild>
              <Link to="/spaces">{t("home.openSpaces")}</Link>
            </Button>
            {canCreate ? (
              <Button variant="secondary" onClick={() => setCreating(true)}>
                {t("spaces.create.action")}
              </Button>
            ) : null}
          </div>
        }
      />
      <CreateSpaceDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function HomeSections() {
  const { t } = useTranslation();
  const format = useFormat();
  const home = useQuery(homeQuery());
  if (home.isPending) {
    return (
      <div className="grid gap-8 md:grid-cols-2">
        <Skeleton className="h-field w-full" />
        <Skeleton className="h-field w-full" />
      </div>
    );
  }
  if (home.isError) {
    return <LoadError what={t("home.loadFailed")} error={home.error} onRetry={() => home.refetch()} />;
  }
  const data = home.data;
  return (
    <div className="flex flex-col gap-8">
      <DueForReview />
      <div className="grid items-start gap-8 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-8">
          <UpcomingMeetings />
          <Section
            title={t("home.tasks")}
            actions={<SectionLink to="/tasks">{t("home.allTasks")}</SectionLink>}
          >
            {data.tasks.length === 0 ? <HomeEmpty text={t("home.noTasks")} /> : null}
            {data.tasks.map((task) => (
              <HomeRow
                key={task.id}
                to={
                  itemHref(
                    { id: task.item.id, kind: task.item.kind, title: task.item.title, link: null },
                    task.item.spaceKey,
                  ) ?? "/tasks"
                }
                leading={<ListChecks aria-hidden="true" className="size-icon-md" />}
                title={task.text || t("tasks.untitled")}
                meta={`${
                  task.dueDate
                    ? task.overdue
                      ? t("tasks.overdueSince", { date: format.day(`${task.dueDate}T12:00:00Z`) })
                      : t("tasks.dueOn", { date: format.day(`${task.dueDate}T12:00:00Z`) })
                    : t("tasks.noDueDate")
                } · ${task.item.title}`}
                {...(task.overdue ? { metaClassName: "text-danger" } : {})}
              />
            ))}
          </Section>
          <Section title={t("home.recent")}>
            {data.recent.length === 0 ? <HomeEmpty text={t("home.noRecent")} /> : null}
            {data.recent.map((item) => {
              const href = itemHref(
                { id: item.id, kind: item.kind, title: item.title, link: null },
                item.spaceKey,
              );
              return href ? (
                <HomeRow
                  key={item.id}
                  to={href}
                  leading={<ItemIcon kind={item.kind} />}
                  title={item.title}
                  meta={`${item.spaceName} · ${format.short(item.viewedAt)}`}
                />
              ) : null;
            })}
          </Section>
          <SharedWithYou />
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <OneOnOnes />
          <Section title={t("home.mentions")}>
            {data.mentions.length === 0 ? <HomeEmpty text={t("home.noMentions")} /> : null}
            {data.mentions.map((mention) => {
              const item = mention.item;
              const href = itemHref(
                { id: item.id, kind: item.kind, title: item.title, link: null },
                item.spaceKey,
              );
              return href ? (
                <HomeRow
                  key={mention.id}
                  to={href}
                  leading={<ItemIcon kind={item.kind} />}
                  title={item.title}
                  meta={
                    mention.actor
                      ? t("home.mentionedBy", { name: mention.actor.name, when: format.short(mention.at) })
                      : format.short(mention.at)
                  }
                />
              ) : null;
            })}
          </Section>
          <Section title={t("home.starred")}>
            {data.starred.items.length === 0 && data.starred.spaces.length === 0 ? (
              <HomeEmpty text={t("home.noStarred")} />
            ) : null}
            {data.starred.spaces.map((space) => (
              <HomeRow
                key={space.id}
                to={`/spaces/${space.key}`}
                leading={<SpaceBadge space={space} size="sm" />}
                title={space.name || t("spaces.personal.label")}
                meta={space.personal ? t("spaces.personal.label") : t("sidebar.spaceType")}
              />
            ))}
            {data.starred.items.map((item) => {
              const href = itemHref(
                { id: item.id, kind: item.kind, title: item.title, link: null },
                item.spaceKey,
              );
              return href ? (
                <HomeRow
                  key={item.id}
                  to={href}
                  leading={<ItemIcon kind={item.kind} />}
                  title={item.title}
                  meta={item.spaceName}
                />
              ) : null;
            })}
          </Section>
          <Section
            title={t("home.posts")}
            actions={<SectionLink to="/blog">{t("home.allPosts")}</SectionLink>}
          >
            {data.posts.length === 0 ? <HomeEmpty text={t("home.noPosts")} /> : null}
            {data.posts.map((post) => (
              <HomeRow
                key={post.id}
                to={postHref(post)}
                leading={<ItemIcon kind="blogPost" />}
                title={post.title}
                meta={[
                  post.spaceName,
                  post.author?.name,
                  post.publishedAt ? format.short(post.publishedAt) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

export function HomeScreen() {
  const { t } = useTranslation();
  const shell = useShell();
  const organization = useOrganizationState();
  const hasSpaces = useHasSpaces();
  useDocumentTitle(t("home.title"));
  const withoutOrganization =
    organization.session.account?.type === "standard" &&
    organization.permissionsLoaded &&
    organization.organizations.length === 0;
  const firstStart = hasSpaces === false;
  const { suggestCollapsedSidebar } = shell;
  useEffect(() => {
    suggestCollapsedSidebar(firstStart);
    return () => suggestCollapsedSidebar(false);
  }, [firstStart, suggestCollapsedSidebar]);
  return (
    <main
      id="main"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the content area scrolls and must be reachable by keyboard
      tabIndex={0}
      className="min-w-0 flex-1 overflow-y-auto outline-none focus-visible:focus-ring"
    >
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader title={t("home.title")} />
        {withoutOrganization ? (
          <WithoutOrganizationNotice />
        ) : firstStart ? (
          <FirstStart />
        ) : hasSpaces === null ? (
          <Skeleton className="h-field w-full" />
        ) : (
          <HomeSections />
        )}
      </div>
    </main>
  );
}
