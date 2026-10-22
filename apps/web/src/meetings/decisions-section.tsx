import { Button, EmptyState, Field, Input, Select, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Flag, ListFilter } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounced } from "../components/table-state.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemSlug } from "../spaces/item-paths.js";
import { pagePath } from "../spaces/space-queries.js";
import { type DecisionQuery, decisionsQuery, topicPath, topicsQuery } from "./queries.js";

const ANY = "any";

function dayStart(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`).toISOString() : undefined;
}

function dayAfter(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(new Date(`${value}T00:00:00`).getTime() + 86_400_000).toISOString()
    : undefined;
}

export function DecisionsSection({ seriesId, spaceKey }: { seriesId: string; spaceKey: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const [filtering, setFiltering] = useState(false);
  const [topicId, setTopicId] = useState(ANY);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const debouncedText = useDebounced(text, 300);
  const query: DecisionQuery = {
    ...(topicId !== ANY ? { topicId } : {}),
    ...(dayStart(from) ? { from: dayStart(from) } : {}),
    ...(dayAfter(to) ? { to: dayAfter(to) } : {}),
    ...(debouncedText.trim() ? { text: debouncedText.trim() } : {}),
  };
  const filtered = Object.keys(query).length > 0;
  const decisions = useQuery(decisionsQuery(seriesId, query));
  const topics = useQuery({ ...topicsQuery(seriesId, { status: "all" }), enabled: filtering });
  const clear = () => {
    setTopicId(ANY);
    setFrom("");
    setTo("");
    setText("");
  };
  return (
    <section aria-labelledby="series-decisions" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="series-decisions" className="flex grow items-center gap-2 text-lg font-semibold">
          <Flag aria-hidden className="size-icon text-text-muted" />
          {t("meetings.decisions.title")}
        </h2>
        <Button
          size="sm"
          variant="secondary"
          icon={ListFilter}
          aria-expanded={filtering}
          onClick={() => setFiltering(!filtering)}
        >
          {t("meetings.decisions.filter")}
        </Button>
      </div>
      {filtering ? (
        <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
          <Field label={t("meetings.decisions.topic")}>
            <Select
              value={topicId}
              onValueChange={setTopicId}
              options={[
                { value: ANY, label: t("meetings.decisions.anyTopic") },
                ...(topics.data ?? []).map((topic) => ({ value: topic.id, label: topic.title })),
              ]}
            />
          </Field>
          <Field label={t("meetings.decisions.text")}>
            <Input
              value={text}
              placeholder={t("meetings.decisions.textExample")}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field label={t("meetings.decisions.from")}>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={t("meetings.decisions.to")}>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
      ) : null}
      {decisions.isPending ? <Skeleton className="h-field w-full" /> : null}
      {decisions.isError ? (
        <LoadError
          what={t("meetings.decisions.loadFailed")}
          error={decisions.error}
          onRetry={() => decisions.refetch()}
        />
      ) : null}
      {decisions.data && decisions.data.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={ListFilter}
            title={t("meetings.decisions.noMatch")}
            action={
              <Button variant="secondary" onClick={clear}>
                {t("meetings.decisions.clearFilters")}
              </Button>
            }
          />
        ) : (
          <p className="text-sm text-text-muted">{t("meetings.decisions.empty")}</p>
        )
      ) : null}
      {decisions.data && decisions.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {decisions.data.map((decision) => (
            <li key={decision.id} className="flex gap-3 rounded-md border border-border p-3">
              <Flag aria-hidden className="mt-1 size-icon shrink-0 text-success" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-medium break-words">
                  {decision.text || t("meetings.decisions.noStatement")}
                </p>
                <p className="text-sm text-text-muted">
                  <Link
                    to={pagePath(spaceKey, decision.meeting.id, itemSlug(decision.meeting.title))}
                    className="text-accent hover:underline focus-visible:focus-ring"
                  >
                    {decision.meeting.startsAt
                      ? format.date(decision.meeting.startsAt)
                      : decision.meeting.title}
                  </Link>
                  {decision.topic ? (
                    <>
                      {" · "}
                      <Link
                        to={topicPath(spaceKey, decision.topic.id)}
                        className="text-accent hover:underline focus-visible:focus-ring"
                      >
                        {decision.topic.title}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
