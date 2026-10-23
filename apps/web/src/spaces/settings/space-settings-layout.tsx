import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { translateKey } from "../../i18n/translate.js";
import { type SettingsEntry, SettingsShell } from "../../screens/settings/settings-shell.js";
import { spaceSettingsItems } from "../../shell/extensions.js";
import { useRegistry } from "../../shell/registry.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";

export function SpaceSettingsLayout() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const items = useRegistry(spaceSettingsItems);
  const name = spaceDisplayName(t, space);
  const entries: SettingsEntry[] = items
    .filter((item) => (item.visible ? item.visible(space) : true))
    .map((item) => ({
      id: item.id,
      label: translateKey(t, item.labelKey),
      href: item.to.replace("$spaceKey", space.key),
      ...(item.groupKey ? { group: translateKey(t, item.groupKey) } : {}),
    }));
  return (
    <SettingsShell
      label={t("spaces.settings.title")}
      eyebrow={t("spaces.settings.title")}
      title={name}
      space={{ key: space.key, name }}
      entries={entries}
    >
      <Outlet />
    </SettingsShell>
  );
}
