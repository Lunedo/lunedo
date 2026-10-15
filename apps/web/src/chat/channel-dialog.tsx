import { type ChatChannelKind, chatChannelKinds } from "@pagehall/shared";
import {
  Button,
  Checkbox,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  RadioGroup,
  useToast,
} from "@pagehall/ui";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { problemMessage } from "../errors/problem-message.js";
import { translateKey } from "../i18n/translate.js";
import {
  type ChatChannel,
  type ChatChannelInput,
  type ChatEventName,
  type ChatOwner,
  type ChatTarget,
  type ChatTestResult,
  createChannel,
  testUnsaved,
  updateChannel,
  useRefreshChannels,
} from "./chat-api.js";
import { failureText, kindLabel } from "./chat-texts.js";

const NAME_MAX = 80;
const DEFAULT_EVENTS = new Set<string>([
  "pagePublished",
  "blogPostPublished",
  "decisionRecorded",
  "announcementPublished",
]);
const STEPS: Record<ChatChannelKind, number> = { teams: 3, slack: 3, matrix: 3, discord: 2, webhook: 2 };

function kindOf(value: string): ChatChannelKind {
  return chatChannelKinds.find((kind) => kind === value) ?? "webhook";
}

function isAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

interface Errors {
  url?: string;
  homeserver?: string;
  roomId?: string;
  accessToken?: string;
  name?: string;
  events?: string;
}

export function ChannelDialog({
  owner,
  events,
  channel,
  open,
  onOpenChange,
  onSecret,
}: {
  owner: ChatOwner;
  events: readonly ChatEventName[];
  channel: ChatChannel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSecret: (secret: { name: string; value: string }) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const refresh = useRefreshChannels(owner);
  const [kind, setKind] = useState<ChatChannelKind>(channel ? kindOf(channel.kind) : "teams");
  const [url, setUrl] = useState("");
  const [homeserver, setHomeserver] = useState("");
  const [roomId, setRoomId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [name, setName] = useState(channel?.name ?? "");
  const [chosen, setChosen] = useState<ChatEventName[]>(() =>
    events.filter((event) => (channel ? channel.events.includes(event) : DEFAULT_EVENTS.has(event))),
  );
  const [newSecret, setNewSecret] = useState(false);
  const [attempted, setAttempted] = useState<"save" | "test" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tested, setTested] = useState<ChatTestResult | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const service = kindLabel(t, kind);
  const addressEntered = kind === "matrix" ? Boolean(homeserver || roomId || accessToken) : Boolean(url);
  const needsAddress = channel === null || addressEntered;

  const target = (): ChatTarget =>
    kind === "matrix"
      ? { homeserver: homeserver.trim(), roomId: roomId.trim(), accessToken: accessToken.trim() }
      : { url: url.trim() };

  const check = (forTest: boolean): Errors => {
    const next: Errors = {};
    if (needsAddress || forTest) {
      if (kind === "matrix") {
        if (!isAddress(homeserver)) next.homeserver = t("chatChannels.homeserverInvalid");
        if (!/^![^:\s]+:\S+$/.test(roomId.trim())) next.roomId = t("chatChannels.roomIdInvalid");
        if (!accessToken.trim()) next.accessToken = t("chatChannels.tokenRequired");
      } else if (!isAddress(url)) {
        next.url = t("chatChannels.addressInvalid");
      }
    }
    const cleaned = name.trim();
    if (!cleaned) next.name = t("chatChannels.nameRequired");
    else if (cleaned.length > NAME_MAX) next.name = t("chatChannels.nameTooLong", { max: NAME_MAX });
    if (chosen.length === 0) next.events = t("chatChannels.eventsRequired");
    return next;
  };

  const errors: Errors = attempted ? check(attempted === "test") : {};

  const validate = (forTest: boolean): boolean => {
    const next = check(forTest);
    setAttempted(forTest ? "test" : "save");
    if (Object.keys(next).length > 0) {
      focusFirstInvalidSoon();
      return false;
    }
    return true;
  };

  const input = (): ChatChannelInput => ({ kind, name: name.trim(), events: chosen, target: target() });

  const sendTest = async () => {
    if (channel && !addressEntered) return;
    if (!validate(true)) return;
    setBusy("test");
    setFailure(null);
    setTested(null);
    try {
      setTested(await testUnsaved(owner, input()));
    } catch (error) {
      setFailure(problemMessage(t, error));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!validate(false)) return;
    setBusy("save");
    setFailure(null);
    try {
      const saved = channel
        ? await updateChannel(owner, channel.id, {
            name: name.trim(),
            events: chosen,
            ...(addressEntered ? { target: target() } : {}),
            ...(newSecret ? { newSecret: true } : {}),
          })
        : await createChannel(owner, input());
      await refresh();
      if (saved.signingSecret) onSecret({ name: saved.channel.name, value: saved.signingSecret });
      toast({
        variant: "success",
        title: channel
          ? t("chatChannels.saved", { name: saved.channel.name })
          : t("chatChannels.connected", { name: saved.channel.name }),
      });
      onOpenChange(false);
    } catch (error) {
      setFailure(problemMessage(t, error));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (event: ChatEventName, checked: boolean) => {
    setChosen((current) =>
      checked
        ? events.filter((entry) => entry === event || current.includes(entry))
        : current.filter((entry) => entry !== event),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={channel ? t("chatChannels.editTitle", { name: channel.name }) : t("chatChannels.connectTitle")}
      description={t("chatChannels.dialogDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          {channel && !addressEntered ? null : (
            <Button variant="secondary" loading={busy === "test"} onClick={() => void sendTest()}>
              {t("chatChannels.sendTest")}
            </Button>
          )}
          <Button variant="primary" loading={busy === "save"} onClick={() => void save()}>
            {channel ? t("chatChannels.save") : t("chatChannels.connect")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {failure ? (
          <Notice
            variant="danger"
            title={channel ? t("chatChannels.saveFailed") : t("chatChannels.connectFailed")}
          >
            {failure}
          </Notice>
        ) : null}
        {tested ? (
          tested.delivered ? (
            <Notice variant="success" title={t("chatChannels.testSent")}>
              {t("chatChannels.testSentDescription", { service })}
            </Notice>
          ) : (
            <Notice variant="danger" title={t("chatChannels.testFailed", { service })}>
              {tested.failure ? failureText(t, kind, tested.failure) : null}
            </Notice>
          )
        ) : null}
        {channel ? null : (
          <RadioGroup
            label={t("chatChannels.service")}
            variant="card"
            value={kind}
            onValueChange={(value) => {
              setKind(value as ChatChannelKind);
              setTested(null);
            }}
            options={chatChannelKinds.map((value) => ({ value, label: kindLabel(t, value) }))}
          />
        )}
        <section
          aria-labelledby="chat-steps"
          className="rounded-md border border-border bg-surface-sunken p-4"
        >
          <h3 id="chat-steps" className="mb-2 font-semibold">
            {t("chatChannels.stepsTitle", { service })}
          </h3>
          <ol className="list-decimal space-y-1 ps-5 text-sm">
            {Array.from({ length: STEPS[kind] }, (_, index) => `chatChannels.steps.${kind}.${index + 1}`).map(
              (key) => (
                <li key={key}>{translateKey(t, key)}</li>
              ),
            )}
          </ol>
        </section>
        {kind === "matrix" ? (
          <>
            <Field
              label={t("chatChannels.homeserver")}
              hint={t("chatChannels.homeserverHint")}
              {...(errors.homeserver ? { error: errors.homeserver } : {})}
            >
              <Input
                type="url"
                inputMode="url"
                className="font-mono"
                value={homeserver}
                onChange={(event) => {
                  setHomeserver(event.target.value);
                }}
              />
            </Field>
            <Field label={t("chatChannels.roomId")} {...(errors.roomId ? { error: errors.roomId } : {})}>
              <Input
                className="font-mono"
                value={roomId}
                onChange={(event) => {
                  setRoomId(event.target.value);
                }}
              />
            </Field>
            <Field
              label={t("chatChannels.accessToken")}
              hint={channel ? t("chatChannels.storedHint") : t("chatChannels.secretHint")}
              {...(errors.accessToken ? { error: errors.accessToken } : {})}
            >
              <Input
                type="password"
                autoComplete="off"
                className="font-mono"
                value={accessToken}
                onChange={(event) => {
                  setAccessToken(event.target.value);
                }}
              />
            </Field>
          </>
        ) : (
          <Field
            label={t("chatChannels.address")}
            hint={channel ? t("chatChannels.storedHint") : t("chatChannels.secretHint")}
            {...(errors.url ? { error: errors.url } : {})}
          >
            <Input
              type="url"
              inputMode="url"
              autoComplete="off"
              className="font-mono"
              value={url}
              placeholder={kind === "teams" ? "https://…logic.azure.com/workflows/…" : "https://…"}
              onChange={(event) => {
                setUrl(event.target.value);
                setTested(null);
              }}
            />
          </Field>
        )}
        <Field
          label={t("chatChannels.name")}
          hint={t("chatChannels.nameHint")}
          {...(errors.name ? { error: errors.name } : {})}
        >
          <Input
            value={name}
            placeholder={t("chatChannels.namePlaceholder")}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{t("chatChannels.postWhen")}</legend>
          {events.map((event) => (
            <Checkbox
              key={event}
              label={translateKey(t, `chatChannels.events.${event}`)}
              checked={chosen.includes(event)}
              onCheckedChange={(checked) => toggle(event, checked)}
              {...(errors.events && event === events[0] ? { error: errors.events } : {})}
            />
          ))}
        </fieldset>
        {channel?.kind === "webhook" ? (
          <Checkbox
            label={t("chatChannels.newSecret")}
            description={t("chatChannels.newSecretDescription")}
            checked={newSecret}
            onCheckedChange={setNewSecret}
          />
        ) : null}
      </form>
    </Dialog>
  );
}

export function eventSummary(t: TFunction, events: readonly string[]): string {
  return events.map((event) => translateKey(t, `chatChannels.short.${event}`)).join(", ");
}
