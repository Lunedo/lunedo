import { Button, Checkbox, Combobox, RadioGroup } from "@pagehall/ui";
import { X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { peopleLoader } from "../collaboration/people.js";
import { statusName } from "../spaces/ownership/ownership-queries.js";
import { contentLanguageLabel } from "./content-language.js";
import type { SearchFacets } from "./search-api.js";
import {
  activeFilterCount,
  clearedFilters,
  type SearchFilters,
  type SearchType,
  searchTypes,
  toggled,
  type UpdatedRange,
  updatedRanges,
} from "./search-params.js";
import { typeLabel } from "./search-results.js";

const VISIBLE_VALUES = 8;

interface FacetValue {
  value: string;
  label: string;
  count: number;
}

function FacetGroup({
  title,
  values,
  selected,
  onToggle,
  onClearHidden,
  children,
}: {
  title: string;
  values: FacetValue[];
  selected: readonly string[];
  onToggle: (value: string, on: boolean) => void;
  onClearHidden: (values: string[]) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const hidden = selected.filter((value) => !values.some((entry) => entry.value === value));
  if (values.length === 0 && hidden.length === 0 && !children) return null;
  const shown = expanded ? values : values.slice(0, VISIBLE_VALUES);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-semibold text-text-muted uppercase">{title}</legend>
      {children}
      {shown.map((entry) => (
        <Checkbox
          key={entry.value}
          checked={selected.includes(entry.value)}
          onCheckedChange={(on) => onToggle(entry.value, on)}
          label={
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate" title={entry.label}>
                {entry.label}
              </span>
              <span className="text-sm text-text-muted tabular-nums">{entry.count}</span>
            </span>
          }
        />
      ))}
      {values.length > VISIBLE_VALUES ? (
        <Button variant="outline" size="sm" onClick={() => setExpanded((open) => !open)}>
          {expanded ? t("search.filters.showFewer") : t("search.filters.showAll", { count: values.length })}
        </Button>
      ) : null}
      {hidden.length > 0 ? (
        <Button variant="outline" size="sm" icon={X} onClick={() => onClearHidden(hidden)}>
          {t("search.filters.clearOthers", { count: hidden.length })}
        </Button>
      ) : null}
    </fieldset>
  );
}

export function SearchFilterPanel({
  facets,
  filters,
  onChange,
  footer,
}: {
  facets: SearchFacets | null;
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
  footer?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const count = activeFilterCount(filters);
  const listToggle =
    <K extends "spaceIds" | "labels" | "authorIds" | "statusIds" | "languages">(key: K) =>
    (value: string, on: boolean) =>
      onChange({ ...filters, [key]: toggled(filters[key], value, on) });
  const listClear =
    <K extends "spaceIds" | "labels" | "authorIds" | "statusIds" | "languages">(key: K) =>
    (values: string[]) =>
      onChange({ ...filters, [key]: filters[key].filter((value) => !values.includes(value)) });

  const typeCounts = new Map((facets?.types ?? []).map((entry) => [entry.value, entry.count]));
  const updatedCounts = new Map((facets?.updated ?? []).map((entry) => [entry.value, entry.count]));
  const rangeLabel = (range: UpdatedRange) =>
    range === "week"
      ? t("search.filters.lastWeek")
      : range === "month"
        ? t("search.filters.lastMonth")
        : t("search.filters.lastYear");

  return (
    <div className="flex flex-col gap-6">
      <FacetGroup
        title={t("search.filters.space")}
        values={(facets?.spaces ?? []).flatMap((entry) =>
          entry.id
            ? [
                {
                  value: entry.id,
                  label: entry.name || (entry.personal ? t("spaces.personal.label") : (entry.key ?? "")),
                  count: entry.count,
                },
              ]
            : [],
        )}
        selected={filters.spaceIds}
        onToggle={listToggle("spaceIds")}
        onClearHidden={listClear("spaceIds")}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-semibold text-text-muted uppercase">
          {t("search.filters.type")}
        </legend>
        {searchTypes.map((type) => (
          <Checkbox
            key={type}
            checked={filters.types.includes(type)}
            onCheckedChange={(on) =>
              onChange({ ...filters, types: toggled<SearchType>(filters.types, type, on) })
            }
            label={
              <span className="flex items-baseline gap-2">
                {typeLabel(t, type)}
                <span className="text-sm text-text-muted tabular-nums">{typeCounts.get(type) ?? 0}</span>
              </span>
            }
          />
        ))}
      </fieldset>
      <div className="flex flex-col gap-2">
        <p aria-hidden="true" className="mb-1 text-xs font-semibold text-text-muted uppercase">
          {t("search.filters.updated")}
        </p>
        <RadioGroup
          label={t("search.filters.updated")}
          value={filters.updated ?? "any"}
          onValueChange={(value) =>
            onChange({ ...filters, updated: value === "any" ? null : (value as UpdatedRange) })
          }
          options={[
            { value: "any", label: t("search.filters.anyTime") },
            ...updatedRanges.map((range) => ({
              value: range,
              label: (
                <span className="flex items-baseline gap-2">
                  {rangeLabel(range)}
                  <span className="text-sm text-text-muted tabular-nums">
                    {updatedCounts.get(range) ?? 0}
                  </span>
                </span>
              ),
            })),
          ]}
        />
      </div>
      <FacetGroup
        title={t("search.filters.label")}
        values={(facets?.labels ?? []).map((entry) => ({
          value: entry.value,
          label: entry.value,
          count: entry.count,
        }))}
        selected={filters.labels}
        onToggle={listToggle("labels")}
        onClearHidden={listClear("labels")}
      />
      <FacetGroup
        title={t("search.filters.status")}
        values={(facets?.statuses ?? []).map((entry) => ({
          value: entry.id,
          label: statusName(t, entry),
          count: entry.count,
        }))}
        selected={filters.statusIds}
        onToggle={listToggle("statusIds")}
        onClearHidden={listClear("statusIds")}
      />
      <FacetGroup
        title={t("search.filters.author")}
        values={(facets?.authors ?? []).map((entry) => ({
          value: entry.id,
          label: entry.name,
          count: entry.count,
        }))}
        selected={filters.authorIds}
        onToggle={listToggle("authorIds")}
        onClearHidden={listClear("authorIds")}
      >
        <Combobox
          aria-label={t("search.filters.findAuthor")}
          placeholder={t("search.filters.findAuthor")}
          value={null}
          load={peopleLoader}
          onValueChange={(value) => {
            if (value) onChange({ ...filters, authorIds: toggled(filters.authorIds, value, true) });
          }}
        />
      </FacetGroup>
      <FacetGroup
        title={t("search.filters.language")}
        values={(facets?.languages ?? []).map((entry) => ({
          value: entry.value,
          label: contentLanguageLabel(t, entry.value, i18n.language),
          count: entry.count,
        }))}
        selected={filters.languages}
        onToggle={listToggle("languages")}
        onClearHidden={listClear("languages")}
      />
      <Checkbox
        checked={filters.includeArchived}
        onCheckedChange={(on) => onChange({ ...filters, includeArchived: on })}
        label={t("search.filters.includeArchived")}
      />
      {count > 0 ? (
        <Button variant="outline" icon={X} onClick={() => onChange(clearedFilters(filters))}>
          {t("search.filters.clear", { count })}
        </Button>
      ) : null}
      {footer}
    </div>
  );
}
