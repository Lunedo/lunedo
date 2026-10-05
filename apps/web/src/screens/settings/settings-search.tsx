import { Button, classNames, controlClassName, EmptyState, Icon, PageContainer, Section } from "@pagehall/ui";
import { Link } from "@tanstack/react-router";
import { Search, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../../i18n/translate.js";
import { searchSettings } from "../../settings/settings-index.js";
import type { NavigationItem } from "../../shell/extensions.js";

export interface SearchArea {
  label: string;
  items: NavigationItem[];
}

export function SettingsSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative w-full">
      <Icon
        icon={Search}
        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-muted"
      />
      <input
        type="search"
        value={value}
        aria-label={t("settings.searchLabel")}
        placeholder={t("settings.searchPlaceholder")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange("");
        }}
        className={classNames(controlClassName, "h-control-field pl-8")}
      />
    </div>
  );
}

export function SettingsSearchResults({
  query,
  areas,
  params,
  onClear,
}: {
  query: string;
  areas: SearchArea[];
  params: { organizationId?: string };
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const translate = (key: string) => translateKey(t, key);
  const results = areas
    .map((area) => ({
      area,
      matches: searchSettings(
        area.items.map((item) => item.id),
        query,
        translate,
      ),
    }))
    .filter((entry) => entry.matches.length > 0);
  const count = results.reduce((sum, entry) => sum + entry.matches.length, 0);
  return (
    <PageContainer width="narrow">
      <p role="status" className="text-text-muted">
        {count > 0 ? t("settings.searchResults", { count, query: query.trim() }) : null}
      </p>
      {count === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t("settings.searchNone", { query: query.trim() })}
          action={<Button onClick={onClear}>{t("settings.searchClear")}</Button>}
        />
      ) : (
        results.map(({ area, matches }) => (
          <Section key={area.label} title={area.label}>
            <ul className="flex flex-col divide-y divide-border">
              {matches.map((match) => {
                const item = area.items.find((candidate) => candidate.id === match.pageId);
                if (!item) return null;
                return (
                  <li
                    key={`${match.pageId}:${match.sectionTitleKey}:${match.entry.id}`}
                    className="px-4 py-3"
                  >
                    <Link
                      to={item.to as never}
                      params={params as never}
                      onClick={onClear}
                      className="flex flex-col gap-1 rounded-sm focus-visible:focus-ring"
                    >
                      <span className="font-medium text-accent hover:underline">
                        {translate(match.entry.labelKey)}
                      </span>
                      <span className="text-xs text-text-muted">
                        {t("settings.searchWhere", {
                          page: translate(item.labelKey),
                          section: translate(match.sectionTitleKey),
                        })}
                      </span>
                      {match.entry.descriptionKey ? (
                        <span className="text-sm text-text-muted">
                          {translate(match.entry.descriptionKey)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        ))
      )}
    </PageContainer>
  );
}
