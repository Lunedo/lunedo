import { type ChatChannelKind, chatChannelKinds } from "@lunedo/shared";
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
} from "@lunedo/ui";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionFailure } from "../errors/failure.js";
import { problemMessage } from "../errors/problem-message.js";
import { completeWebAddress, isWebAddress } from "../forms/addresses.js";
import { serverFieldErrors } from "../forms/use-schema-form.js";
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
  return isWebAddress(completeWebAddress(value));
}

interface Errors {
  url?: string;
  homeserver?: string;
  roomId?: string;
  accessToken?: string;
  name?: string;
  events?: string;
}

const SERVER_FIELDS: Record<string, keyof Errors> = {
  "target.url": "url",
  "target.homeserver": "homeserver",
  "target.roomId": "roomId",
  "target.accessToken": "accessToken",
  name: "name",
  events: "events",
};

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
  const [failure, setFailure] = useState<{ action: "test" | "save"; message: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [tested, setTested] = useState<ChatTestResult | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const service = kindLabel(t, kind);
  const addressEntered = kind === "matrix" ? Boolean(homeserver || roomId || accessToken) : Boolean(url);
  const needsAddress = channel === null || addressEntered;

  const target = (): ChatTarget =>
    kind === "matrix"
      ? { homeserver: completeWebAddress(homeserver), roomId: roomId.trim(), accessToken: accessToken.trim() }
      : { url: completeWebAddress(url) };

  const check = (forTest: boolean): Errors => {
    const next: Errors = {};
    if (needsAddress || forTest) {
      if (kind === "matrix") {
        if (!isAddress(homeserver)) next.homeserver = t("chatChannels.homeserverInvalid");
        if (!roomId.trim()) next.roomId = t("chatChannels.roomIdInvalid");
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

  const errors: Errors = { ...serverErrors, ...(attempted ? check(attempted === "test") : {}) };

  const clearServerError = (field: keyof Errors) =>
    setServerErrors((current) => {
      const { [field]: _removed, ...rest } = current;
      return rest;
    });

  const showFailure = (action: "test" | "save", error: unknown) => {
    const fields = serverFieldErrors(t, error);
    const mapped: Errors = {};
    for (const [path, message] of Object.entries(fields)) {
      const field = SERVER_FIELDS[path];
      if (field) mapped[field] = message;
    }
    if (Object.keys(mapped).length > 0) {
      setServerErrors(mapped);
      focusFirstInvalidSoon();
      return;
    }
    setFailure({ action, message: problemMessage(t, error) });
  };

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
      showFailure("test", error);
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
      showFailure("save", error);
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
          <ActionFailure
            title={
              failure.action === "test"
                ? t("chatChannels.testNotDelivered")
                : channel
                  ? t("chatChannels.saveFailed")
                  : t("chatChannels.connectFailed")
            }
            message={failure.message}
          />
        ) : null}
        {tested ? (
          tested.delivered ? (
            <Notice variant="success" title={t("chatChannels.testSent")}>
              {t("chatChannels.testSentDescription", { service })}
            </Notice>
          ) : (
            <ActionFailure
              title={t("chatChannels.testFailed", { service })}
              message={tested.failure ? failureText(t, kind, tested.failure) : ""}
            />
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
              setServerErrors({});
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
                  clearServerError("homeserver");
                }}
              />
            </Field>
            <Field
              label={t("chatChannels.roomId")}
              hint={t("chatChannels.roomIdHint")}
              {...(errors.roomId ? { error: errors.roomId } : {})}
            >
              <Input
                className="font-mono"
                value={roomId}
                onChange={(event) => {
                  setRoomId(event.target.value);
                  clearServerError("roomId");
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
                  clearServerError("accessToken");
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
                clearServerError("url");
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
              clearServerError("name");
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
