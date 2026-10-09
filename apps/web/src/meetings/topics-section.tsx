import {
  Badge,
  Button,
  Combobox,
  type ComboboxItem,
  EmptyState,
  Field,
  Input,
  Select,
  Skeleton,
} from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ListFilter, Plus, Repeat } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { peopleLoader } from "../collaboration/people.js";
import { useDebounced } from "../components/table-state.js";
import { LoadError } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { type TopicQuery, topicPath, topicsQuery } from "./queries.js";

function periodStart(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`).toISOString() : undefined;
}

function periodEnd(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(new Date(`${value}T00:00:00`).getTime() + 86_400_000).toISOString()
    : undefined;
}

export function TopicsSection({
  seriesId,
  spaceKey,
  canEdit,
  onAdd,
}: {
  seriesId: string;
  spaceKey: string;
  canEdit: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const [filtering, setFiltering] = useState(false);
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [owner, setOwner] = useState<ComboboxItem | null>(null);
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const debouncedText = useDebounced(text, 300);
  const debouncedLabel = useDebounced(label, 300);
  const query: TopicQuery = {
    status,
    ...(owner ? { ownerId: owner.value } : {}),
    ...(debouncedLabel.trim() ? { label: debouncedLabel.trim() } : {}),
    ...(periodStart(from) ? { from: periodStart(from) } : {}),
    ...(periodEnd(to) ? { to: periodEnd(to) } : {}),
    ...(debouncedText.trim() ? { text: debouncedText.trim() } : {}),
  };
  const filtered = Object.keys(query).length > 1 || status !== "open";
  const topics = useQuery(topicsQuery(seriesId, query));
  const clear = () => {
    setStatus("open");
    setOwner(null);
    setLabel("");
    setFrom("");
    setTo("");
    setText("");
  };
  return (
    <section aria-labelledby="series-topics" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="series-topics" className="flex grow items-center gap-2 text-lg font-semibold">
          <Repeat aria-hidden className="size-icon text-text-muted" />
          {t("meetings.topics.title")}
        </h2>
        <Button
          size="sm"
          variant="secondary"
          icon={ListFilter}
          aria-expanded={filtering}
          onClick={() => setFiltering(!filtering)}
        >
          {t("meetings.topics.filter")}
        </Button>
        {canEdit ? (
          <Button size="sm" variant="secondary" icon={Plus} onClick={onAdd}>
            {t("meetings.topics.add")}
          </Button>
        ) : null}
      </div>
      {filtering ? (
        <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
          <Field label={t("meetings.topics.status")}>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as typeof status)}
              options={(["open", "closed", "all"] as const).map((value) => ({
                value,
                label: translateKey(t, `meetings.topics.statusFilter.${value}`),
              }))}
            />
          </Field>
          <Field label={t("meetings.topics.owner")}>
            <Combobox
              load={peopleLoader}
              value={owner?.value ?? null}
              selectedItem={owner}
              placeholder={t("meetings.topics.anyone")}
              onValueChange={(_value, item) => setOwner(item)}
            />
          </Field>
          <Field label={t("meetings.topics.label")}>
            <Input value={label} onChange={(event) => setLabel(event.target.value)} />
          </Field>
          <Field label={t("meetings.topics.text")}>
            <Input
              value={text}
              placeholder={t("meetings.topics.textExample")}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <Field label={t("meetings.topics.from")}>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={t("meetings.topics.to")}>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          {filtered ? (
            <div className="sm:col-span-2">
              <Button size="sm" variant="outline" onClick={clear}>
                {t("meetings.topics.clearFilters")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {topics.isPending ? <Skeleton className="h-field w-full" /> : null}
      {topics.isError ? (
        <LoadError
          what={t("meetings.topics.loadFailed")}
          error={topics.error}
          onRetry={() => topics.refetch()}
        />
      ) : null}
      {topics.data && topics.data.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={ListFilter}
            title={t("meetings.topics.noMatch")}
            action={
              <Button variant="secondary" onClick={clear}>
                {t("meetings.topics.clearFilters")}
              </Button>
            }
          />
        ) : (
          <p className="text-sm text-text-muted">{t("meetings.topics.empty")}</p>
        )
      ) : null}
      {topics.data && topics.data.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {topics.data.map((topic) => (
            <li key={topic.id}>
              <Link
                to={topicPath(spaceKey, topic.id)}
                className="flex min-h-hit flex-wrap items-center gap-2 px-3 py-2 hover:bg-hover focus-visible:focus-ring"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium" title={topic.title}>
                    {topic.title}
                  </span>
                  <span className="text-sm text-text-muted">
                    {[
                      topic.owner?.name ?? t("meetings.topics.noOwner"),
                      topic.lastUpdateAt
                        ? t("meetings.topics.updated", { date: format.date(topic.lastUpdateAt) })
                        : t("meetings.topics.since", { date: format.date(topic.createdAt) }),
                      t("meetings.topics.updates", { count: topic.updates }),
                    ].join(" · ")}
                  </span>
                </span>
                {topic.labels.map((name) => (
                  <Badge key={name}>{name}</Badge>
                ))}
                {topic.status === "closed" ? (
                  <Badge variant={topic.outcome === "decided" ? "success" : "neutral"}>
                    {translateKey(t, `meetings.topics.outcome.${topic.outcome ?? "resolved"}`)}
                  </Badge>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
