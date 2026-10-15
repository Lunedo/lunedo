import { ConfirmDialog, Section, SettingRow, Switch } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SettingEntry } from "../api/organization-queries.js";
import { SaveIndicator, useSaveState } from "../components/auto-save.js";
import { useInstanceSettingMutation } from "../settings/setting-mutations.js";
import { pushKeys } from "./browser-push.js";
import { watchKeys } from "./watching-api.js";

const KEY = "notifications.browserPush";

export function BrowserPushSetting({
  settings,
  editable,
}: {
  settings: readonly SettingEntry[] | undefined;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutation = useInstanceSettingMutation();
  const tracker = useSaveState();
  const [confirming, setConfirming] = useState(false);
  const entry = settings?.find((setting) => setting.key === KEY);
  const enabled = entry?.value === true;

  const save = (value: boolean) =>
    tracker.run(async () => {
      await mutation.mutateAsync({ key: KEY, change: { value } });
      await queryClient.invalidateQueries({ queryKey: watchKeys.delivery });
      await queryClient.invalidateQueries({ queryKey: pushKeys.status });
    });

  return (
    <Section title={t("notifications.push.title")}>
      <SettingRow
        label={t("notifications.push.instanceLabel")}
        description={t("notifications.push.instanceDescription")}
        control={
          <Switch
            label={t("notifications.push.instanceLabel")}
            labelHidden
            checked={enabled}
            disabled={!editable || !entry}
            {...(!editable ? { disabledReason: t("notifications.push.instanceReadOnly") } : {})}
            onCheckedChange={(checked) => {
              if (checked) setConfirming(true);
              else void save(false);
            }}
          />
        }
        status={<SaveIndicator tracker={tracker} />}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("notifications.push.enableTitle")}
        description={t("notifications.push.enableDescription")}
        confirmLabel={t("notifications.push.enableConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={async () => {
          await save(true);
        }}
      >
        <ul className="list-disc space-y-1 ps-5 text-sm">
          <li>{t("notifications.push.enableEncrypted")}</li>
          <li>{t("notifications.push.enableContent")}</li>
          <li>{t("notifications.push.enablePerDevice")}</li>
        </ul>
      </ConfirmDialog>
    </Section>
  );
}
