import { FilterMenu, type FilterOption } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounced } from "../components/table-state.js";
import { statusName } from "../spaces/ownership/ownership-queries.js";
import { contentLanguageLabel } from "./content-language.js";
import { peopleQuery, type SearchFacets } from "./search-api.js";
import {
  type SearchFilters,
  type SearchType,
  searchTypes,
  toggled,
  type UpdatedRange,
  updatedRanges,
} from "./search-params.js";
import { typeLabel } from "./search-results.js";

const ARCHIVED = "archived";

export function SearchFilterChips({
  facets,
  filters,
  onChange,
}: {
  facets: SearchFacets | null;
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}) {
  const { t, i18n } = useTranslation();
  const [authorSearch, setAuthorSearch] = useState("");
  const authorTerm = useDebounced(authorSearch.trim());
  const people = useQuery({
    ...peopleQuery(authorTerm, 10),
    enabled: authorTerm.length > 0,
    throwOnError: false,
  });
  const toggle =
    <K extends "spaceIds" | "labels" | "authorIds" | "statusIds" | "languages">(key: K) =>
    (value: string, on: boolean) =>
      onChange({ ...filters, [key]: toggled(filters[key], value, on) });

  const counted = <T,>(entries: readonly T[], option: (entry: T) => FilterOption | null) =>
    entries.flatMap((entry) => {
      const value = option(entry);
      return value ? [value] : [];
    });
  const keep = (options: FilterOption[], selected: readonly string[], label: (value: string) => string) => [
    ...options,
    ...selected
      .filter((value) => !options.some((option) => option.value === value))
      .map((value) => ({ value, label: label(value), count: 0 })),
  ];

  const spaces = keep(
    counted(facets?.spaces ?? [], (entry) =>
      entry.id
        ? {
            value: entry.id,
            label: entry.name || (entry.personal ? t("spaces.personal.label") : (entry.key ?? "")),
            count: entry.count,
          }
        : null,
    ),
    filters.spaceIds,
    () => t("search.filters.otherSpace"),
  );
  const typeCounts = new Map((facets?.types ?? []).map((entry) => [entry.value, entry.count]));
  const updatedCounts = new Map((facets?.updated ?? []).map((entry) => [entry.value, entry.count]));
  const rangeLabel = (range: UpdatedRange) =>
    range === "week"
      ? t("search.filters.lastWeek")
      : range === "month"
        ? t("search.filters.lastMonth")
        : t("search.filters.lastYear");
  const authorNames = new Map<string, string>([
    ...(facets?.authors ?? []).map((entry) => [entry.id, entry.name] as const),
    ...(people.data?.items ?? []).map((person) => [person.id, person.name] as const),
  ]);
  const authors = keep(
    authorTerm
      ? (people.data?.items ?? []).map((person) => ({
          value: person.id,
          label: person.name,
          ...(person.email ? { description: person.email } : {}),
        }))
      : (facets?.authors ?? []).map((entry) => ({ value: entry.id, label: entry.name, count: entry.count })),
    filters.authorIds,
    (id) => authorNames.get(id) ?? t("search.filters.chosenPerson"),
  );
  const languages = keep(
    (facets?.languages ?? []).map((entry) => ({
      value: entry.value,
      label: contentLanguageLabel(t, entry.value, i18n.language),
      count: entry.count,
    })),
    filters.languages,
    (value) => contentLanguageLabel(t, value, i18n.language),
  );
  const more: FilterOption[] = [
    ...keep(
      (facets?.labels ?? []).map((entry) => ({
        value: `label:${entry.value}`,
        label: entry.value,
        count: entry.count,
      })),
      filters.labels.map((label) => `label:${label}`),
      (value) => value.slice("label:".length),
    ).map((option) => ({ ...option, group: t("search.filters.label") })),
    ...keep(
      (facets?.statuses ?? []).map((entry) => ({
        value: `status:${entry.id}`,
        label: statusName(t, entry),
        count: entry.count,
      })),
      filters.statusIds.map((id) => `status:${id}`),
      () => t("search.filters.otherStatus"),
    ).map((option) => ({ ...option, group: t("search.filters.status") })),
    { value: ARCHIVED, label: t("search.filters.includeArchived"), group: t("search.filters.options") },
  ];
  const moreSelected = [
    ...filters.labels.map((label) => `label:${label}`),
    ...filters.statusIds.map((id) => `status:${id}`),
    ...(filters.includeArchived ? [ARCHIVED] : []),
  ];

  return (
    <>
      <FilterMenu
        multiple
        label={t("search.filters.space")}
        selected={filters.spaceIds}
        options={spaces}
        onToggle={toggle("spaceIds")}
      />
      <FilterMenu
        multiple
        label={t("search.filters.type")}
        selected={filters.types}
        options={searchTypes.map((type) => ({
          value: type,
          label: typeLabel(t, type),
          ...(facets ? { count: typeCounts.get(type) ?? 0 } : {}),
        }))}
        onToggle={(value, on) =>
          onChange({ ...filters, types: toggled<SearchType>(filters.types, value as SearchType, on) })
        }
      />
      <FilterMenu
        label={t("search.filters.updated")}
        value={filters.updated ?? ""}
        options={[
          { value: "", label: t("search.filters.anyTime") },
          ...updatedRanges.map((range) => ({
            value: range,
            label: rangeLabel(range),
            ...(facets ? { count: updatedCounts.get(range) ?? 0 } : {}),
          })),
        ]}
        {...(filters.updated ? {} : { valueLabel: "" })}
        onValueChange={(value) => onChange({ ...filters, updated: value ? (value as UpdatedRange) : null })}
      />
      <FilterMenu
        multiple
        label={t("search.filters.author")}
        selected={filters.authorIds}
        options={authors}
        search={{
          value: authorSearch,
          onChange: setAuthorSearch,
          placeholder: t("search.filters.findAuthor"),
        }}
        onToggle={toggle("authorIds")}
      />
      {languages.length > 0 ? (
        <FilterMenu
          multiple
          label={t("search.filters.language")}
          selected={filters.languages}
          options={languages}
          onToggle={toggle("languages")}
        />
      ) : null}
      <FilterMenu
        multiple
        label={t("search.filters.more")}
        selected={moreSelected}
        options={more}
        onToggle={(value, on) => {
          if (value === ARCHIVED) onChange({ ...filters, includeArchived: on });
          else if (value.startsWith("label:"))
            onChange({ ...filters, labels: toggled(filters.labels, value.slice("label:".length), on) });
          else
            onChange({
              ...filters,
              statusIds: toggled(filters.statusIds, value.slice("status:".length), on),
            });
        }}
      />
    </>
  );
}
