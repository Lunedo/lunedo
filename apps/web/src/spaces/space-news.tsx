import { Section } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { HomeRow } from "../collaboration/home-rows.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { newestInSpaceQuery, type SearchHit } from "../search/search-api.js";
import { hitHref, hitIcon, hitTitle, typeLabel } from "../search/search-results.js";

const SHOWN = 5;
const FETCHED = 20;

export function SpaceNews({
  organizationId,
  spaceId,
  overviewId,
}: {
  organizationId: string;
  spaceId: string;
  overviewId: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const newest = useQuery({ ...newestInSpaceQuery(organizationId, spaceId, FETCHED), throwOnError: false });
  if (newest.isPending) return null;
  if (newest.isError) {
    return <LoadError what={t("spaces.news.title")} error={newest.error} onRetry={() => newest.refetch()} />;
  }
  const seen = new Set([overviewId]);
  const hits: SearchHit[] = [];
  for (const hit of newest.data.results) {
    if (seen.has(hit.itemId) || hits.length === SHOWN) continue;
    seen.add(hit.itemId);
    hits.push({ ...hit, heading: "", anchor: null });
  }
  if (hits.length === 0) return null;
  return (
    <Section title={t("spaces.news.title")}>
      {hits.map((hit) => {
        const href = hitHref(hit);
        if (!href) return null;
        const Glyph = hitIcon(hit);
        return (
          <HomeRow
            key={hit.id}
            to={href}
            leading={<Glyph aria-hidden="true" className="size-icon-md" />}
            title={hitTitle(t, hit)}
            meta={[
              hit.type === "page" ? null : typeLabel(t, hit.type),
              hit.author?.name,
              format.short(hit.updatedAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        );
      })}
    </Section>
  );
}
