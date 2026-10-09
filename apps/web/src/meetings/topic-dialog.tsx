import { Button, Combobox, type ComboboxItem, Dialog, Field, Input, useToast } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoader } from "../collaboration/people.js";
import { problemMessage } from "../errors/problem-message.js";
import { useSession } from "../shell/shell-context.js";
import { meetingKeys } from "./queries.js";

const TITLE_MAX = 255;

export function TopicDialog({
  seriesId,
  meetingId,
  open,
  onOpenChange,
}: {
  seriesId: string;
  meetingId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const self = useSession().account;
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<ComboboxItem | null>(null);
  const [labels, setLabels] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && self) setOwner({ value: self.id, label: self.name });
  }, [open, self]);

  const create = async () => {
    const value = title.trim();
    if (value.length === 0 || value.length > TITLE_MAX) {
      setError(t("meetings.topics.titleInvalid", { max: TITLE_MAX }));
      titleInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await request(() =>
        api.POST("/api/v1/meeting-series/{seriesId}/topics", {
          params: { path: { seriesId } },
          body: {
            title: value,
            ownerId: owner?.value ?? null,
            labels: labels
              .split(",")
              .map((label) => label.trim())
              .filter(Boolean),
            ...(meetingId ? { meetingId } : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["pages"] });
      toast({ variant: "success", title: t("meetings.topics.added", { title: value }) });
      setTitle("");
      setLabels("");
      setError(null);
      onOpenChange(false);
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.topics.addFailed"),
        description: problemMessage(t, failure),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("meetings.topics.addTitle")}
      description={t("meetings.topics.addDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            {t("meetings.topics.add")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Field label={t("meetings.topics.titleLabel")} error={error ?? undefined} required>
          <Input
            ref={titleInput}
            value={title}
            placeholder={t("meetings.topics.titleExample")}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <Field label={t("meetings.topics.owner")}>
          <Combobox
            load={peopleLoader}
            value={owner?.value ?? null}
            selectedItem={owner}
            onValueChange={(_value, item) => setOwner(item)}
          />
        </Field>
        <Field label={t("meetings.topics.labels")} hint={t("meetings.topics.labelsHint")}>
          <Input
            value={labels}
            placeholder={t("meetings.topics.labelsExample")}
            onChange={(event) => setLabels(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}
