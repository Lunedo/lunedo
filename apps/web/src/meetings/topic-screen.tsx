import { type DocumentJson, renderHtml } from "@lunedo/editor-schema";
import {
  Badge,
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  Input,
  Menu,
  Notice,
  PageHeader,
  Skeleton,
  Textarea,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { CheckCircle2, Flag, Repeat, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { useContentCollaboration } from "../collaboration/content-collaboration.js";
import { peopleLoader } from "../collaboration/people.js";
import { readViewContext } from "../editor/read-view.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { itemSlug } from "../spaces/item-paths.js";
import { spaceDisplayName } from "../spaces/space-badge.js";
import { useSpace } from "../spaces/space-context.js";
import { pagePath } from "../spaces/space-queries.js";
import { meetingKeys, seriesPath, type TopicDetails, topicQuery } from "./queries.js";
import "../editor/editor.css";

const route = getRouteApi("/app/spaces/$spaceKey/topics/$topicId");
const STATEMENT_MAX = 2000;

export function TopicScreen() {
  const { t } = useTranslation();
  const { topicId } = route.useParams();
  const topic = useQuery({ ...topicQuery(topicId), retry: false });
  useDocumentTitle(topic.data?.title ?? t("meetings.topics.title"));
  if (topic.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-content flex-col gap-4 px-4 pt-6 md:px-8">
        <Skeleton className="h-field w-2/3" />
        <Skeleton className="h-field w-full" />
      </div>
    );
  }
  if (topic.isError) {
    return (
      <div className="p-6">
        {topic.error instanceof ApiError && topic.error.status === 404 ? (
          <Notice variant="warning" title={t("meetings.topic.notFoundTitle")}>
            {t("meetings.topic.notFoundDescription")}
          </Notice>
        ) : (
          <LoadError
            what={t("meetings.topic.loadFailed")}
            error={topic.error}
            onRetry={() => topic.refetch()}
          />
        )}
      </div>
    );
  }
  return <TopicView topic={topic.data} />;
}

function UpdateContent({ content }: { content: unknown[] }) {
  const { t } = useTranslation();
  const format = useFormat();
  const html = useMemo(
    () =>
      renderHtml(
        { type: "doc", content } as DocumentJson,
        readViewContext({ people: {}, pages: {} }, t, format),
      ),
    [content, t, format],
  );
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated update
    <div className="ld-content" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function TopicView({ topic }: { topic: TopicDetails }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const format = useFormat();
  const queryClient = useQueryClient();
  const { space, canEdit } = useSpace();
  const [deciding, setDeciding] = useState(false);
  const [editing, setEditing] = useState(false);
  const writable = canEdit && !space.archived;
  const collaboration = useContentCollaboration({
    itemId: topic.id,
    spaceId: space.id,
    role: space.role,
    archived: space.archived,
    writable,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: meetingKeys.all });
  const closeAs = async (outcome: "resolved" | "dropped") => {
    try {
      await request(() =>
        api.POST("/api/v1/topics/{topicId}/close", {
          params: { path: { topicId: topic.id } },
          body: { outcome },
        }),
      );
      await refresh();
      toast({ variant: "success", title: translateKey(t, `meetings.topic.closed.${outcome}`) });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.topic.closeFailed"),
        description: problemMessage(t, failure),
      });
    }
  };
  const reopen = async () => {
    try {
      await request(() =>
        api.POST("/api/v1/topics/{topicId}/reopen", { params: { path: { topicId: topic.id } } }),
      );
      await refresh();
      toast({ variant: "success", title: t("meetings.topic.reopened") });
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.topic.reopenFailed"),
        description: problemMessage(t, failure),
      });
    }
  };

  return (
    <div className="flex min-h-full">
      <article className="mx-auto flex w-full max-w-content min-w-0 flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
        <PageHeader
          title={topic.title}
          icon={Repeat}
          breadcrumbs={[
            { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
            { label: t("meetings.title"), href: `/spaces/${space.key}/meetings` },
            { label: topic.seriesTitle, href: seriesPath(space.key, topic.seriesId) },
            { label: topic.title },
          ]}
          actions={
            <>
              {writable && topic.status === "open" ? (
                <>
                  <Button variant="primary" icon={Flag} onClick={() => setDeciding(true)}>
                    {t("meetings.topic.decide")}
                  </Button>
                  <Menu
                    trigger={
                      <Button variant="secondary" icon={CheckCircle2}>
                        {t("meetings.topic.close")}
                      </Button>
                    }
                    items={[
                      { label: t("meetings.topic.closeResolved"), onSelect: () => void closeAs("resolved") },
                      { label: t("meetings.topic.closeDropped"), onSelect: () => void closeAs("dropped") },
                    ]}
                  />
                </>
              ) : null}
              {writable && topic.status === "closed" ? (
                <Button variant="secondary" icon={RotateCcw} onClick={() => void reopen()}>
                  {t("meetings.topic.reopen")}
                </Button>
              ) : null}
              {writable ? (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t("meetings.topic.edit")}
                </Button>
              ) : null}
              {collaboration.commentsButton}
            </>
          }
        />
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div className="flex flex-col">
            <dt className="text-sm text-text-muted">{t("meetings.topic.status")}</dt>
            <dd>
              <Badge
                variant={
                  topic.status === "open" ? "info" : topic.outcome === "decided" ? "success" : "neutral"
                }
              >
                {topic.status === "open"
                  ? t("meetings.topic.open")
                  : translateKey(t, `meetings.topics.outcome.${topic.outcome ?? "resolved"}`)}
              </Badge>
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-sm text-text-muted">{t("meetings.topics.owner")}</dt>
            <dd>{topic.owner?.name ?? t("meetings.topics.noOwner")}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-sm text-text-muted">{t("meetings.topic.raised")}</dt>
            <dd>
              {topic.raisedIn ? (
                <Link
                  to={pagePath(space.key, topic.raisedIn.id, itemSlug(topic.raisedIn.title))}
                  className="text-accent hover:underline focus-visible:focus-ring"
                >
                  {topic.raisedIn.startsAt ? format.date(topic.raisedIn.startsAt) : topic.raisedIn.title}
                </Link>
              ) : (
                format.date(topic.createdAt)
              )}
            </dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-sm text-text-muted">{t("meetings.topics.labels")}</dt>
            <dd className="flex flex-wrap gap-1">
              {topic.labels.length > 0
                ? topic.labels.map((label) => <Badge key={label}>{label}</Badge>)
                : t("meetings.topic.noLabels")}
            </dd>
          </div>
        </dl>
        {topic.decision ? (
          <section aria-labelledby="topic-decision" className="ld-decision">
            <h2 id="topic-decision" className="ld-decision-label">
              <Flag aria-hidden className="size-icon-sm" />
              {t("meetings.topic.decision")}
            </h2>
            <UpdateContent content={topic.decision.statement} />
            <Link
              to={pagePath(space.key, topic.decision.itemId, itemSlug(topic.decision.itemTitle))}
              className="text-sm text-accent hover:underline focus-visible:focus-ring"
            >
              {topic.decision.itemTitle}
            </Link>
          </section>
        ) : null}
        <section aria-labelledby="topic-timeline" className="flex flex-col gap-3">
          <h2 id="topic-timeline" className="text-lg font-semibold">
            {t("meetings.topic.timeline")}
          </h2>
          {topic.timeline.length === 0 ? (
            <p className="text-sm text-text-muted">{t("meetings.topic.noUpdates")}</p>
          ) : null}
          <ol className="flex flex-col gap-3">
            {topic.timeline.map((entry) => (
              <li key={entry.meetingId} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <Link
                  to={pagePath(space.key, entry.meetingId, itemSlug(entry.meetingTitle))}
                  className="text-sm font-medium text-accent hover:underline focus-visible:focus-ring"
                >
                  {entry.startsAt ? format.date(entry.startsAt) : entry.meetingTitle}
                </Link>
                <UpdateContent content={entry.content} />
              </li>
            ))}
          </ol>
        </section>
        <DecideDialog topic={topic} open={deciding} onOpenChange={setDeciding} />
        <EditTopicDialog topic={topic} open={editing} onOpenChange={setEditing} />
      </article>
      {collaboration.panel}
    </div>
  );
}

function DecideDialog({
  topic,
  open,
  onOpenChange,
}: {
  topic: TopicDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statement, setStatement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const decide = async () => {
    if (statement.trim().length === 0 || statement.trim().length > STATEMENT_MAX) {
      setError(t("meetings.topic.statementInvalid", { max: STATEMENT_MAX }));
      input.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await request(() =>
        api.POST("/api/v1/topics/{topicId}/decision", {
          params: { path: { topicId: topic.id } },
          body: { statement: statement.trim() },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      toast({ variant: "success", title: t("meetings.topic.decided") });
      setStatement("");
      onOpenChange(false);
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.topic.decideFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("meetings.topic.decideTitle", { title: topic.title })}
      description={t("meetings.topic.decideDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={Flag} loading={busy} onClick={() => void decide()}>
            {t("meetings.topic.decideConfirm")}
          </Button>
        </>
      }
    >
      <Field
        label={t("meetings.topic.statement")}
        hint={t("meetings.topic.statementHint")}
        error={error ?? undefined}
      >
        <Textarea
          ref={input}
          rows={4}
          value={statement}
          onChange={(event) => {
            setStatement(event.target.value);
            if (error) setError(null);
          }}
        />
      </Field>
    </Dialog>
  );
}

function EditTopicDialog({
  topic,
  open,
  onOpenChange,
}: {
  topic: TopicDetails;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(topic.title);
  const [owner, setOwner] = useState<ComboboxItem | null>(
    topic.owner ? { value: topic.owner.id, label: topic.owner.name ?? t("meetings.unknownPerson") } : null,
  );
  const [labels, setLabels] = useState(topic.labels.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const save = async () => {
    if (title.trim().length === 0 || title.trim().length > 255) {
      setError(
        title.trim().length === 0
          ? t("meetings.topics.titleRequired", { max: 255 })
          : t("meetings.topics.titleInvalid", { max: 255 }),
      );
      titleInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await request(() =>
        api.PATCH("/api/v1/topics/{topicId}", {
          params: { path: { topicId: topic.id } },
          body: {
            title: title.trim(),
            ownerId: owner?.value ?? null,
            labels: labels
              .split(",")
              .map((label) => label.trim())
              .filter(Boolean),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      toast({ variant: "success", title: t("meetings.topic.saved") });
      onOpenChange(false);
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.topic.saveFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("meetings.topic.editTitle")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t("meetings.topic.save")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label={t("meetings.topics.titleLabel")} error={error ?? undefined} required>
          <Input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label={t("meetings.topics.owner")}>
          <Combobox
            load={peopleLoader}
            value={owner?.value ?? null}
            selectedItem={owner}
            onValueChange={(_value, item) => setOwner(item)}
          />
        </Field>
        <Field label={t("meetings.topics.labels")} hint={t("meetings.topics.labelsHint")}>
          <Input value={labels} onChange={(event) => setLabels(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
