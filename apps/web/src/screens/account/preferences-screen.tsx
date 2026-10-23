import { textSizes } from "@lunedo/shared";
import {
  IconButton,
  Menu,
  Section,
  SegmentedControl,
  SettingRow,
  Skeleton,
  Stepper,
  Switch,
} from "@lunedo/ui";
import { MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../../api/organization-queries.js";
import { SaveIndicator, useSaveStates } from "../../components/auto-save.js";
import { SettingControl } from "../../components/setting-control.js";
import { disabledReason, inheritedValue, SettingSource } from "../../components/setting-source.js";
import { translateKey } from "../../i18n/translate.js";
import { preferenceKeys, usePreferenceList, useUpdatePreference } from "../../preferences/preferences.js";
import { useFormat, usePreferences } from "../../preferences/preferences-provider.js";
import { localeOptionSets } from "../../settings/locale-options.js";
import { settingField } from "../../settings/setting-fields.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function PreferencesScreen() {
  const { t, i18n } = useTranslation();
  const preferences = usePreferences();
  const format = useFormat();
  const list = usePreferenceList();
  const update = useUpdatePreference();
  const saveState = useSaveStates();
  const organization = useOrganizationState();
  const homeOrganization = organization.organizations.find((entry) => entry.membershipKind === "member");

  const save = async (key: string, value: unknown) => {
    await saveState(key).run(() => update.mutateAsync({ key, value }));
  };
  const set = (key: string, value: unknown) => void save(key, value);

  return (
    <SettingsPage title={t("preferences.title")} description={t("preferences.description")}>
      <Section title={t("preferences.display")}>
        <SettingRow
          label={t("preferences.colorMode")}
          description={t("preferences.colorModeHint")}
          status={<SaveIndicator tracker={saveState(preferenceKeys.colorMode)} />}
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
          status={<SaveIndicator tracker={saveState(preferenceKeys.highContrast)} />}
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
          status={<SaveIndicator tracker={saveState(preferenceKeys.textSize)} />}
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
          status={<SaveIndicator tracker={saveState(preferenceKeys.density)} />}
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
          status={<SaveIndicator tracker={saveState(preferenceKeys.font)} />}
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
      <Section title={t("preferences.navigation")}>
        <SettingRow
          label={t("preferences.startPage")}
          description={t("preferences.startPageHint")}
          status={<SaveIndicator tracker={saveState(preferenceKeys.startPage)} />}
          control={
            <SegmentedControl
              label={t("preferences.startPage")}
              value={preferences.startPage}
              onValueChange={(value) => set(preferenceKeys.startPage, value)}
              options={[
                { value: "forYou", label: t("preferences.startPages.forYou") },
                { value: "organizationHome", label: t("preferences.startPages.organizationHome") },
              ]}
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
          const field = settingField(set_.key);
          const label = translateKey(t, set_.labelKey);
          const inherited = inheritedValue(entry, "user");
          const formatValue = (value: unknown) => set_.formatValue(t, value, i18n.language);
          return (
            <SettingRow
              key={set_.key}
              label={label}
              meta={
                <SettingSource
                  entry={entry}
                  level="user"
                  {...(homeOrganization ? { organizationName: homeOrganization.name } : {})}
                  formatValue={formatValue}
                />
              }
              status={<SaveIndicator tracker={saveState(set_.key)} />}
              control={
                field ? (
                  <SettingControl
                    key={own ? "own" : "inherited"}
                    field={field}
                    label={label}
                    value={own ? entry.value : inherited}
                    inheritedValue={inherited}
                    inherited={!own}
                    inheritedLabel={formatValue(inherited)}
                    disabled={locked}
                    disabledReason={
                      locked ? disabledReason(t, entry, "user", true, homeOrganization?.name) : undefined
                    }
                    onSave={(value) => save(set_.key, value)}
                    onFollowDefault={() => save(set_.key, undefined)}
                  />
                ) : null
              }
              menu={
                own && !locked ? (
                  <Menu
                    align="end"
                    trigger={
                      <IconButton label={t("settings.moreFor", { name: label })} icon={MoreHorizontal} />
                    }
                    items={[
                      { label: t("settings.resetToDefault"), onSelect: () => set(set_.key, undefined) },
                    ]}
                  />
                ) : null
              }
            />
          );
        })}
      </Section>
    </SettingsPage>
  );
}
