import {
  Badge,
  Button,
  ConfirmDialog,
  List,
  ListRow,
  Notice,
  Section,
  SettingRow,
  Skeleton,
} from "@lunedo/ui";
import type { TFunction } from "i18next";
import { MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import {
  type PushDevice,
  PushPermissionError,
  pushSupported,
  useEnablePush,
  usePushStatus,
  useRemovePushDevice,
} from "./browser-push.js";

function deviceName(t: TFunction, device: PushDevice): string {
  if (device.browser && device.operatingSystem) {
    return t("notifications.push.deviceName", { browser: device.browser, system: device.operatingSystem });
  }
  return device.browser ?? device.operatingSystem ?? t("notifications.push.unknownDevice");
}

export function BrowserPushSection() {
  const { t } = useTranslation();
  const format = useFormat();
  const status = usePushStatus();
  const enable = useEnablePush();
  const remove = useRemovePushDevice();
  const [failure, setFailure] = useState<string | null>(null);
  const [removing, setRemoving] = useState<PushDevice | null>(null);

  if (status.isPending) {
    return (
      <Section title={t("notifications.push.title")}>
        <Skeleton className="h-12 w-full" />
      </Section>
    );
  }
  if (status.isError) {
    return (
      <Section title={t("notifications.push.title")}>
        <LoadError what={t("notifications.push.loadFailed")} error={status.error} onRetry={status.refetch} />
      </Section>
    );
  }
  const { enabled, publicKey, devices } = status.data;
  if (!enabled || !publicKey) {
    return (
      <Section title={t("notifications.push.title")}>
        <SettingRow
          label={t("notifications.push.thisDevice")}
          description={t("notifications.push.instanceOff")}
          help={t("notifications.push.instanceOffHelp")}
          control={<Badge>{t("notifications.push.off")}</Badge>}
        />
      </Section>
    );
  }
  const current = devices.find((device) => device.current);
  const supported = pushSupported();

  const turnOn = async () => {
    setFailure(null);
    try {
      await enable.mutateAsync(publicKey);
    } catch (error) {
      setFailure(
        error instanceof PushPermissionError
          ? t("notifications.push.permissionDenied")
          : error instanceof ApiError
            ? problemMessage(t, error)
            : t("notifications.push.browserFailed"),
      );
    }
  };

  const removeDevice = async (device: PushDevice) => {
    setFailure(null);
    try {
      await remove.mutateAsync(device);
    } catch (error) {
      setFailure(problemMessage(t, error));
      throw error;
    }
  };

  return (
    <Section title={t("notifications.push.title")}>
      {failure ? (
        <div className="pt-3">
          <Notice
            variant="danger"
            title={t("notifications.push.failed")}
            action={
              <Button variant="secondary" size="sm" onClick={() => void turnOn()}>
                {t("errors.retry")}
              </Button>
            }
          >
            {failure}
          </Notice>
        </div>
      ) : null}
      <SettingRow
        label={t("notifications.push.thisDevice")}
        description={supported ? t("notifications.push.explanation") : t("notifications.push.unsupported")}
        control={
          !supported ? null : current ? (
            <Button variant="secondary" loading={remove.isPending} onClick={() => void removeDevice(current)}>
              {t("notifications.push.turnOff")}
            </Button>
          ) : (
            <Button variant="secondary" loading={enable.isPending} onClick={() => void turnOn()}>
              {t("notifications.push.turnOn")}
            </Button>
          )
        }
      />
      {devices.length > 0 ? (
        <List label={t("notifications.push.devices")}>
          {devices.map((device) => (
            <ListRow
              key={device.id}
              icon={MonitorSmartphone}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="wrap-anywhere">{deviceName(t, device)}</span>
                  {device.current ? <Badge variant="accent">{t("notifications.push.current")}</Badge> : null}
                </span>
              }
              description={
                device.lastDeliveredAt
                  ? t("notifications.push.deviceSeen", {
                      added: format.date(device.createdAt),
                      delivered: format.dateTime(device.lastDeliveredAt),
                    })
                  : t("notifications.push.deviceAdded", { added: format.date(device.createdAt) })
              }
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t("notifications.push.removeDevice", { device: deviceName(t, device) })}
                  onClick={() => setRemoving(device)}
                >
                  {t("notifications.push.remove")}
                </Button>
              }
            />
          ))}
        </List>
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("notifications.push.removeTitle", { device: removing ? deviceName(t, removing) : "" })}
        description={t("notifications.push.removeEffect")}
        confirmLabel={t("notifications.push.removeConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => (removing ? removeDevice(removing) : undefined)}
      />
    </Section>
  );
}
