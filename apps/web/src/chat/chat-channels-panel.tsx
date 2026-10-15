import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  Dialog,
  IconButton,
  Input,
  Notice,
  Skeleton,
  TruncatedText,
  useToast,
} from "@pagehall/ui";
import { Hash, MessageCircle, MessagesSquare, Pencil, Plus, Send, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { Panel } from "../spaces/settings/panel.js";
import { ChannelDialog, eventSummary } from "./channel-dialog.js";
import {
  type ChatChannel,
  type ChatEventName,
  type ChatOwner,
  removeChannel,
  useChatChannels,
  useRefreshChannels,
  useTestSaved,
} from "./chat-api.js";
import { failureText, kindLabel } from "./chat-texts.js";

const ICONS = {
  teams: MessagesSquare,
  slack: Hash,
  matrix: MessageCircle,
  discord: MessageCircle,
  webhook: Webhook,
} as const;

function iconOf(kind: string) {
  return kind in ICONS ? ICONS[kind as keyof typeof ICONS] : Webhook;
}

export function ChatChannelsPanel({
  owner,
  events,
  title,
  description,
  canManage,
  unavailable,
}: {
  owner: ChatOwner;
  events: readonly ChatEventName[];
  title: string;
  description: string;
  canManage: boolean;
  unavailable?: string | undefined;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const channels = useChatChannels(owner, canManage && !unavailable);
  const refresh = useRefreshChannels(owner);
  const test = useTestSaved(owner);
  const [editing, setEditing] = useState<ChatChannel | "new" | null>(null);
  const [removing, setRemoving] = useState<ChatChannel | null>(null);
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);

  const sendTest = async (channel: ChatChannel) => {
    const service = kindLabel(t, channel.kind);
    try {
      const result = await test.mutateAsync(channel.id);
      if (result.delivered) {
        toast({
          variant: "success",
          title: t("chatChannels.testSent"),
          description: t("chatChannels.testSentDescription", { service }),
        });
      } else {
        toast({
          variant: "error",
          title: t("chatChannels.testFailed", { service }),
          ...(result.failure ? { description: failureText(t, channel.kind, result.failure) } : {}),
        });
      }
    } catch (error) {
      toast({
        variant: "error",
        title: t("chatChannels.testFailed", { service }),
        description: problemMessage(t, error),
      });
    }
  };

  const hint = (channel: ChatChannel) => {
    const parts = [kindLabel(t, channel.kind), eventSummary(t, channel.events)];
    if (channel.state === "failing" && channel.failure) {
      parts.push(t("chatChannels.failingSince", { time: format.relative(channel.failure.at) }));
    } else if (channel.lastDeliveredAt) {
      parts.push(t("chatChannels.lastDelivered", { time: format.relative(channel.lastDeliveredAt) }));
    } else {
      parts.push(t("chatChannels.nothingYet"));
    }
    return parts.join(" · ");
  };

  if (unavailable) {
    return (
      <Panel title={title} description={description}>
        <Notice title={t("chatChannels.unavailableTitle")}>{unavailable}</Notice>
      </Panel>
    );
  }
  if (!canManage) {
    return (
      <Panel title={title} description={description}>
        <p className="text-sm text-text-muted">{t("chatChannels.adminsOnly")}</p>
      </Panel>
    );
  }
  const items = channels.data?.items ?? [];
  const failing = items.filter((channel) => channel.state === "failing");
  return (
    <Panel
      title={title}
      description={description}
      actions={
        <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing("new")}>
          {t("chatChannels.connectAction")}
        </Button>
      }
    >
      {channels.isPending ? <Skeleton className="h-field w-full" /> : null}
      {channels.isError ? (
        <LoadError
          what={t("chatChannels.loadFailed")}
          error={channels.error}
          onRetry={() => channels.refetch()}
        />
      ) : null}
      {channels.data && items.length === 0 ? (
        <p className="text-sm text-text-muted">{t("chatChannels.empty")}</p>
      ) : null}
      {items.length > 0 ? (
        <ul aria-label={title} className="flex flex-col divide-y divide-border">
          {items.map((channel) => {
            const Icon = iconOf(channel.kind);
            return (
              <li key={channel.id} className="flex flex-wrap items-center gap-3 py-3">
                <Icon aria-hidden className="size-icon shrink-0 text-text-muted" />
                <div className="flex min-w-0 flex-1 basis-field flex-col">
                  <TruncatedText text={channel.name} className="font-medium" />
                  <span className="text-sm text-text-muted wrap-anywhere">{hint(channel)}</span>
                </div>
                <Badge variant={channel.state === "failing" ? "danger" : "success"}>
                  {channel.state === "failing" ? t("chatChannels.failing") : t("chatChannels.working")}
                </Badge>
                <div className="ms-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={Send}
                    loading={test.isPending && test.variables === channel.id}
                    aria-label={t("chatChannels.sendTestTo", { name: channel.name })}
                    onClick={() => void sendTest(channel)}
                  >
                    {t("chatChannels.sendTestShort")}
                  </Button>
                  <IconButton
                    label={t("chatChannels.edit", { name: channel.name })}
                    icon={Pencil}
                    onClick={() => setEditing(channel)}
                  />
                  <IconButton
                    label={t("chatChannels.disconnect", { name: channel.name })}
                    icon={Trash2}
                    onClick={() => setRemoving(channel)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {failing.map((channel) => (
        <Notice
          key={channel.id}
          variant="warning"
          title={t("chatChannels.failingTitle", { service: kindLabel(t, channel.kind), name: channel.name })}
          action={
            <Button size="sm" variant="secondary" onClick={() => setEditing(channel)}>
              {t("chatChannels.fix")}
            </Button>
          }
        >
          {channel.failure
            ? `${failureText(t, channel.kind, channel.failure)} ${t("chatChannels.notDelivered")}`
            : t("chatChannels.notDelivered")}
        </Notice>
      ))}
      {editing ? (
        <ChannelDialog
          key={editing === "new" ? "new" : editing.id}
          owner={owner}
          events={events}
          channel={editing === "new" ? null : editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSecret={setSecret}
        />
      ) : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
        title={t("chatChannels.disconnectTitle", { name: removing?.name ?? "" })}
        description={t("chatChannels.disconnectEffect", {
          service: removing ? kindLabel(t, removing.kind) : "",
        })}
        confirmLabel={t("chatChannels.disconnectConfirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await removeChannel(owner, removing.id);
            toast({ variant: "success", title: t("chatChannels.disconnected", { name: removing.name }) });
          } catch (error) {
            toast({
              variant: "error",
              title: t("chatChannels.disconnectFailed"),
              description: problemMessage(t, error),
            });
            throw error;
          } finally {
            await refresh();
          }
        }}
      />
      <Dialog
        open={secret !== null}
        onOpenChange={(open) => {
          if (!open) setSecret(null);
        }}
        title={t("chatChannels.secretTitle", { name: secret?.name ?? "" })}
        footer={
          <Button variant="primary" onClick={() => setSecret(null)}>
            {t("chatChannels.secretDone")}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Notice variant="warning" title={t("chatChannels.secretOnce")}>
            {t("chatChannels.secretDescription")}
          </Notice>
          <div className="flex flex-col gap-1">
            <span className="font-medium">{t("chatChannels.secretLabel")}</span>
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <Input
                readOnly
                value={secret?.value ?? ""}
                aria-label={t("chatChannels.secretLabel")}
                className="font-mono"
              />
              <CopyButton value={secret?.value ?? ""} />
            </div>
          </div>
        </div>
      </Dialog>
    </Panel>
  );
}
