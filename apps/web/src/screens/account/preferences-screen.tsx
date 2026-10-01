import { textSizes } from "@pagehall/shared";
import { Section, SegmentedControl, Select, SettingRow, Skeleton, Stepper, Switch } from "@pagehall/ui";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../../api/organization-queries.js";
import { inheritedValue, SettingSource } from "../../components/setting-source.js";
import { useFailureToast } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { preferenceKeys, usePreferenceList, useUpdatePreference } from "../../preferences/preferences.js";
import { useFormat, usePreferences } from "../../preferences/preferences-provider.js";
import { localeOptionSets } from "../../settings/locale-options.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const INHERIT = "inherit";

export function PreferencesScreen() {
  const { t, i18n } = useTranslation();
  const preferences = usePreferences();
  const format = useFormat();
  const list = usePreferenceList();
  const update = useUpdatePreference();
  const showFailure = useFailureToast();
  const organization = useOrganizationState();
  const homeOrganization = organization.organizations.find((entry) => entry.membershipKind === "member");

  const set = (key: string, value: unknown) =>
    update.mutate({ key, value }, { onError: (error) => showFailure(t("failures.saveSetting"), error) });

  return (
    <SettingsPage title={t("preferences.title")} description={t("preferences.description")} icon={Palette}>
      <Section title={t("preferences.display")}>
        <SettingRow
          label={t("preferences.colorMode")}
          description={t("preferences.colorModeHint")}
          control={
            <SegmentedControl
              label={t("preferences.colorMode")}
              value={preferences.colorMode}
              onValueChange={(value) => set(preferenceKeys.colorMode, value)}
              options={[
                { value: "system", label: t("preferences.colorModes.system") },
                { value: "light", label: t("preferences.colorModes.light") },
                { value: "dark", label: t("preferences.colorModes.dark") },
              ]}
            />
          }
        />
        <SettingRow
          label={t("preferences.highContrast")}
          description={t("preferences.highContrastHint")}
          control={
            <Switch
              label={t("preferences.highContrast")}
              labelHidden
              checked={preferences.highContrast}
              onCheckedChange={(checked) => set(preferenceKeys.highContrast, checked)}
            />
          }
        />
        <SettingRow
          label={t("preferences.textSize")}
          description={t("preferences.textSizeHint")}
          control={
            <Stepper
              label={t("preferences.textSize")}
              value={preferences.textSize}
              steps={textSizes}
              defaultValue={1}
              onValueChange={(value) => set(preferenceKeys.textSize, value)}
              formatValue={(value) => format.percent(value)}
            />
          }
        />
        <SettingRow
          label={t("preferences.density")}
          description={t("preferences.densityHint")}
          control={
            <SegmentedControl
              label={t("preferences.density")}
              value={preferences.density}
              onValueChange={(value) => set(preferenceKeys.density, value)}
              options={[
                { value: "default", label: t("preferences.densities.default") },
                { value: "compact", label: t("preferences.densities.compact") },
              ]}
            />
          }
        />
        <SettingRow
          label={t("preferences.readableFont")}
          description={t("preferences.readableFontHint")}
          control={
            <Switch
              label={t("preferences.readableFont")}
              labelHidden
              checked={preferences.font === "readable"}
              onCheckedChange={(checked) => set(preferenceKeys.font, checked ? "readable" : "default")}
            />
          }
        />
      </Section>
      <Section title={t("preferences.languageAndRegion")}>
        {list.isPending ? <Skeleton className="h-12 w-full" /> : null}
        {localeOptionSets.map((set_) => {
          const entry = list.data?.find((candidate) => candidate.key === set_.key) as
            | SettingEntry
            | undefined;
          if (!entry) return null;
          const own = entry.source === "user";
          const locked = entry.lockedBy !== null;
          const options = set_.options(t, i18n.language);
          return (
            <SettingRow
              key={set_.key}
              label={translateKey(t, set_.labelKey)}
              meta={
                <SettingSource
                  entry={entry}
                  level="user"
                  {...(homeOrganization ? { organizationName: homeOrganization.name } : {})}
                  formatValue={(value) => set_.formatValue(t, value, i18n.language)}
                />
              }
              control={
                <div className="w-full sm:w-field">
                  <Select
                    aria-label={translateKey(t, set_.labelKey)}
                    value={own ? String(entry.value) : INHERIT}
                    disabled={locked}
                    onValueChange={(value) => set(set_.key, value === INHERIT ? undefined : value)}
                    options={[
                      {
                        value: INHERIT,
                        label: t("settings.source.fromDefault", {
                          value: set_.formatValue(t, inheritedValue(entry, "user"), i18n.language),
                        }),
                      },
                      ...options,
                    ]}
                  />
                </div>
              }
            />
          );
        })}
      </Section>
    </SettingsPage>
  );
}
