import {
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  RadioGroup,
  Select,
  useToast,
} from "@lunedo/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { peopleLoader } from "../collaboration/people.js";
import { problemMessage } from "../errors/problem-message.js";
import { useSession } from "../shell/shell-context.js";
import { seriesPath } from "../spaces/space-queries.js";
import { meetingKeys, type Series } from "./queries.js";

export function SuccessorDialog({
  series,
  open,
  onOpenChange,
}: {
  series: Series;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const self = useSession().account?.id ?? "";
  const others = series.members.filter((member) => member.id !== self);
  const [previous, setPrevious] = useState<string | undefined>(others[0]?.id);
  const [successor, setSuccessor] = useState<ComboboxItem | null>(null);
  const [mode, setMode] = useState<"add" | "new">("add");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const previousName = others.find((member) => member.id === previous)?.name ?? t("meetings.unknownPerson");

  const submit = async () => {
    if (!successor || !previous) {
      setError(t("meetings.successor.chooseSuccessor"));
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    try {
      const result = await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/one-on-one/successor", {
          params: { path: { spaceId: series.spaceId } },
          body: { previousId: previous, successorId: successor.value, mode },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: meetingKeys.all });
      await queryClient.invalidateQueries({ queryKey: ["spaces"] });
      toast({
        variant: "success",
        title: t(mode === "add" ? "meetings.successor.added" : "meetings.successor.started", {
          name: successor.label,
        }),
      });
      onOpenChange(false);
      if (mode === "new" && result.seriesNumber !== null) {
        const space = await request(() =>
          api.GET("/api/v1/spaces/{spaceId}", { params: { path: { spaceId: result.spaceId } } }),
        );
        await navigate({ to: seriesPath(space.key, result.seriesNumber, "") });
      }
    } catch (failure) {
      toast({
        variant: "error",
        title: t("meetings.successor.failed"),
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
      title={t("meetings.successor.title")}
      description={t("meetings.successor.description")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {mode === "add" ? t("meetings.successor.confirmAdd") : t("meetings.successor.confirmNew")}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {others.length > 1 ? (
          <Field label={t("meetings.successor.previous")}>
            <Select
              value={previous}
              onValueChange={setPrevious}
              options={others.map((member) => ({
                value: member.id,
                label: member.name ?? t("meetings.unknownPerson"),
              }))}
            />
          </Field>
        ) : null}
        <Field label={t("meetings.successor.successor")} error={error ?? undefined} required>
          <Combobox
            load={peopleLoader}
            value={successor?.value ?? null}
            selectedItem={successor}
            onValueChange={(_value, item) => {
              setSuccessor(item);
              setError(null);
            }}
          />
        </Field>
        <RadioGroup
          label={t("meetings.successor.how")}
          variant="card"
          value={mode}
          onValueChange={(value) => setMode(value as "add" | "new")}
          options={[
            {
              value: "add",
              label: t("meetings.successor.add"),
              description: t("meetings.successor.addDescription", { name: previousName }),
            },
            {
              value: "new",
              label: t("meetings.successor.new"),
              description: t("meetings.successor.newDescription"),
            },
          ]}
        />
      </form>
    </Dialog>
  );
}
