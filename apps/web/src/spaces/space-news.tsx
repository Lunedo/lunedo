import { Section } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { HomeRow } from "../collaboration/home-rows.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { hitIcon, typeLabel } from "../search/search-results.js";
import { contentQuery, newestContentQuery } from "./space-queries.js";

const SHOWN = 5;

export function SpaceNews({ spaceId, overviewId }: { spaceId: string; overviewId: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const content = useQuery({ ...contentQuery(overviewId), enabled: false });
  const newest = useQuery({
    ...newestContentQuery(spaceId, SHOWN + 1),
    enabled: content.isSuccess || content.isError,
    throwOnError: false,
  });
  if (newest.isPending) return null;
  if (newest.isError) {
    return <LoadError what={t("spaces.news.title")} error={newest.error} onRetry={() => newest.refetch()} />;
  }
  const items = newest.data.filter((item) => item.id !== overviewId).slice(0, SHOWN);
  if (items.length === 0) return null;
  return (
    <Section title={t("spaces.news.title")}>
      {items.map((item) => {
        const Glyph = hitIcon({ type: item.kind });
        return (
          <HomeRow
            key={item.id}
            to={item.path}
            leading={<Glyph aria-hidden="true" className="size-icon-md" />}
            title={item.title}
            meta={[
              item.kind === "page" ? null : typeLabel(t, item.kind),
              item.author?.name,
              format.short(item.contentUpdatedAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        );
      })}
    </Section>
  );
}
