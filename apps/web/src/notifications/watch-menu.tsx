import { Button, Checkbox, Dialog, IconButton, Menu, type MenuItem, useToast } from "@lunedo/ui";
import { Bell, BellOff, BellRing } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFailureToast } from "../errors/failure.js";
import {
  useChangeWatch,
  useWatchStatus,
  type WatchChange,
  type WatchStatus,
  type WatchTarget,
} from "./watching-api.js";

export function previousChange(status: WatchStatus | undefined): WatchChange {
  return status?.own
    ? { state: status.own.state, keepActionable: status.own.keepActionable }
    : { state: null };
}

export function WatchMenu({
  target,
  name,
  size = "md",
}: {
  target: WatchTarget;
  name: string;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const failed = useFailureToast();
  const status = useWatchStatus(target);
  const change = useChangeWatch();
  const [muting, setMuting] = useState(false);
  const [keepActionable, setKeepActionable] = useState(true);
  const effective = status.data?.effective ?? null;
  const own = status.data?.own ?? null;
  const watching = effective?.state === "watching";
  const muted = effective?.state === "muted";

  const apply = (next: WatchChange, done: string) => {
    const previous = previousChange(status.data);
    change.mutate(
      { target, change: next },
      {
        onSuccess: () =>
          toast({ title: done, undo: { onUndo: () => change.mutate({ target, change: previous }) } }),
        onError: (error) => failed(t("notifications.watching.changeFailed"), error, () => apply(next, done)),
      },
    );
  };

  const stopWatching: WatchChange = target.type === "space" ? { state: null } : { state: "notWatching" };
  const viaParent =
    effective && effective.source !== "target"
      ? t(
          effective.state === "muted"
            ? effective.source === "series"
              ? "notifications.watching.mutedViaSeries"
              : "notifications.watching.mutedViaSpace"
            : effective.source === "series"
              ? "notifications.watching.viaSeries"
              : "notifications.watching.viaSpace",
        )
      : null;

  const items: MenuItem[] = [
    ...(viaParent && (watching || muted) ? [{ type: "label" as const, label: viaParent }] : []),
    ...(watching
      ? [
          {
            label: t("notifications.watching.unwatch"),
            icon: Bell,
            onSelect: () => apply(stopWatching, t("notifications.watching.removed", { name })),
          },
        ]
      : muted
        ? []
        : [
            {
              label:
                target.type === "space"
                  ? t("notifications.watching.watchSpace")
                  : t("notifications.watching.watch"),
              icon: BellRing,
              onSelect: () => apply({ state: "watching" }, t("notifications.watching.started", { name })),
            },
          ]),
    ...(own?.state === "muted"
      ? [
          {
            label: t("notifications.watching.unmuteAction"),
            icon: Bell,
            onSelect: () => apply({ state: null }, t("notifications.watching.unmuted", { name })),
          },
        ]
      : [
          {
            label: t("notifications.watching.mute"),
            icon: BellOff,
            onSelect: () => {
              setKeepActionable(true);
              setMuting(true);
            },
          },
        ]),
  ];

  const icon = muted ? BellOff : watching ? BellRing : Bell;
  const label = !status.data
    ? t("notifications.watching.menu", { name })
    : muted
      ? t("notifications.watching.menuMuted", { name })
      : watching
        ? t("notifications.watching.menuWatched", { name })
        : t("notifications.watching.menuNotWatched", { name });
  return (
    <>
      <Menu
        align="end"
        trigger={
          <IconButton
            label={label}
            icon={icon}
            size={size}
            {...(watching ? { variant: "primary" as const } : {})}
          />
        }
        items={items}
      />
      <Dialog
        open={muting}
        onOpenChange={setMuting}
        title={t("notifications.watching.muteTitle", { name })}
        description={t("notifications.watching.muteDescription", { name })}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMuting(false)}>
              {t("notifications.watching.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setMuting(false);
                apply({ state: "muted", keepActionable }, t("notifications.watching.mutedToast", { name }));
              }}
            >
              {t("notifications.watching.muteConfirm")}
            </Button>
          </>
        }
      >
        <Checkbox
          checked={keepActionable}
          onCheckedChange={setKeepActionable}
          label={t("notifications.watching.keepActionable")}
        />
      </Dialog>
    </>
  );
}
