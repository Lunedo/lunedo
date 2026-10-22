import { Badge, Icon, Popover, Skeleton, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, CircleSlash, Flag, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { spaceKeys } from "../space-queries.js";
import { ownershipKeys, type PageStatus, pageStatusesQuery, statusName } from "./ownership-queries.js";

const OPTION =
  "flex min-h-hit w-full items-center gap-2 rounded-sm px-2 text-sm hover:bg-hover focus-visible:focus-ring aria-pressed:bg-accent-soft";

const STATUS_CLASSES: Record<PageStatus["color"], string> = {
  neutral: "bg-hover text-text-muted",
  accent: "bg-accent-soft text-accent",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function StatusBadge({ status }: { status: Pick<PageStatus, "builtIn" | "name" | "color"> }) {
  const { t } = useTranslation();
  return (
    <Badge variant={status.color === "accent" ? "accent" : status.color} icon={Flag}>
      {statusName(t, status)}
    </Badge>
  );
}

export function PageStatusControl({
  itemId,
  spaceId,
  status,
  editable,
}: {
  itemId: string;
  spaceId: string;
  status: PageStatus | null;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  if (!editable) return status ? <StatusBadge status={status} /> : null;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      label={t("pageStatus.title")}
      trigger={
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`inline-flex h-control-sm items-center gap-1 rounded-sm px-2 text-xs font-semibold focus-visible:focus-ring ${status ? STATUS_CLASSES[status.color] : "border border-dashed border-border text-text-muted"}`}
        >
          <Icon icon={Flag} size="sm" />
          {status ? statusName(t, status) : t("pageStatus.set")}
          <span className="sr-only">{t("pageStatus.change")}</span>
          <Icon icon={ChevronDown} size="sm" />
        </button>
      }
    >
      <StatusChoices itemId={itemId} spaceId={spaceId} status={status} onDone={() => setOpen(false)} />
    </Popover>
  );
}

function StatusChoices({
  itemId,
  spaceId,
  status,
  onDone,
}: {
  itemId: string;
  spaceId: string;
  status: PageStatus | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const values = useQuery(pageStatusesQuery(spaceId));
  const [busy, setBusy] = useState<string | null>(null);

  const choose = async (statusId: string | null) => {
    setBusy(statusId ?? "none");
    try {
      await request(() =>
        api.PUT("/api/v1/items/{itemId}/status", { params: { path: { itemId } }, body: { statusId } }),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: spaceKeys.item(itemId) }),
        queryClient.invalidateQueries({ queryKey: ["spaces", spaceId, "children"] }),
        queryClient.invalidateQueries({ queryKey: ownershipKeys.statuses(spaceId) }),
        queryClient.invalidateQueries({ queryKey: ownershipKeys.activity(itemId) }),
      ]);
      onDone();
    } catch (error) {
      toast({ title: t("pageStatus.setFailed"), description: problemMessage(t, error), variant: "error" });
      await queryClient.invalidateQueries({ queryKey: ownershipKeys.statuses(spaceId) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-w-field max-w-full flex-col gap-2">
      <p className="text-sm font-semibold">{t("pageStatus.title")}</p>
      {values.isPending ? <Skeleton className="h-control w-full" /> : null}
      {values.isError ? (
        <LoadError what={t("pageStatus.loadFailed")} error={values.error} onRetry={() => values.refetch()} />
      ) : null}
      {values.data ? (
        <ul className="flex flex-col gap-1">
          {values.data.values.map((value) => {
            const selected = status?.id === value.id;
            return (
              <li key={value.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-busy={busy === value.id}
                  className={OPTION}
                  onClick={() => void choose(value.id)}
                >
                  <span className="inline-flex flex-1 items-center gap-2">
                    <StatusBadge status={value} />
                  </span>
                  {busy === value.id ? (
                    <Icon icon={LoaderCircle} size="sm" className="animate-spin motion-reduce:animate-none" />
                  ) : selected ? (
                    <Icon icon={Check} size="sm" className="text-accent" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {status ? (
        <button
          type="button"
          aria-busy={busy === "none"}
          className={OPTION}
          onClick={() => void choose(null)}
        >
          <Icon
            icon={busy === "none" ? LoaderCircle : CircleSlash}
            size="sm"
            className={busy === "none" ? "animate-spin motion-reduce:animate-none" : "text-text-muted"}
          />
          <span className="flex-1 text-start">{t("pageStatus.remove")}</span>
        </button>
      ) : null}
      <p className="text-xs text-text-muted">{t("pageStatus.setByAdmins")}</p>
    </div>
  );
}
