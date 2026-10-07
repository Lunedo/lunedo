import { Dialog, Kbd } from "@pagehall/ui";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { translateKey } from "../i18n/translate.js";
import { shortcuts } from "./extensions.js";
import { displayKey } from "./keyboard.js";
import { useRegistry } from "./registry.js";

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const list = useRegistry(shortcuts);
  const groups = (["general", "navigation", "editor"] as const)
    .map((group) => ({
      group,
      items: list.filter((shortcut) => shortcut.group === group),
    }))
    .filter(({ items }) => items.length > 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("shortcuts.title")} size="md">
      <div className="flex flex-col gap-5">
        {groups.map(({ group, items }) => (
          <section key={group} aria-labelledby={`shortcuts-${group}`} className="flex flex-col gap-2">
            <h3
              id={`shortcuts-${group}`}
              className="font-semibold text-sm text-text-muted uppercase tracking-label"
            >
              {t(`shortcuts.groups.${group}`)}
            </h3>
            <dl className="flex flex-col gap-2">
              {items.map((shortcut) => (
                <div key={shortcut.id} className="flex items-center justify-between gap-4">
                  <dt>{translateKey(t, shortcut.labelKey)}</dt>
                  <dd className="flex gap-1">
                    {shortcut.keys.map((key, index) => (
                      <Fragment key={`${shortcut.id}-${key}`}>
                        {index > 0 ? (
                          <span className="text-sm text-text-muted">{t("shortcuts.then")}</span>
                        ) : null}
                        <Kbd>{displayKey(key)}</Kbd>
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
