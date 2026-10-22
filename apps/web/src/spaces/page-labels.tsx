import { Button, Combobox, Popover, useToast } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus, Tag, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { problemMessage } from "../errors/problem-message.js";
import { useSpace } from "./space-context.js";
import { labelsQuery, spaceKeys } from "./space-queries.js";

export function normalizeLabel(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}._-]/gu, "")
    .replace(/-+/g, "-");
}

export function PageLabels({ pageId }: { pageId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { space, canEdit } = useSpace();
  const queryClient = useQueryClient();
  const labels = useQuery(labelsQuery(pageId));
  const [open, setOpen] = useState(false);
  const current = labels.data ?? [];

  const update = (next: string[]) => {
    queryClient.setQueryData(spaceKeys.labels(pageId), next);
    void queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "labels"] });
  };

  const add = async (label: string) => {
    const value = normalizeLabel(label);
    if (!value) return;
    try {
      update(
        await request(() =>
          api.POST("/api/v1/pages/{pageId}/labels", { params: { path: { pageId } }, body: { label: value } }),
        ),
      );
      setOpen(false);
    } catch (error) {
      toast({ title: t("labels.addFailed"), description: problemMessage(t, error), variant: "error" });
    }
  };

  const remove = async (label: string) => {
    const before = current;
    update(current.filter((entry) => entry !== label));
    try {
      update(
        await request(() =>
          api.DELETE("/api/v1/pages/{pageId}/labels/{label}", { params: { path: { pageId, label } } }),
        ),
      );
      toast({
        title: t("labels.removed", { label }),
        undo: { seconds: 10, onUndo: () => void add(label) },
      });
    } catch (error) {
      update(before);
      toast({ title: t("labels.removeFailed"), description: problemMessage(t, error), variant: "error" });
    }
  };

  if (!canEdit && current.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul aria-label={t("labels.title")} className="flex flex-wrap items-center gap-2">
        {current.map((label) => (
          <li
            key={label}
            className="relative inline-flex h-control-sm items-center rounded-full bg-surface-sunken text-sm"
          >
            <Link
              to="/spaces/$spaceKey/labels/$label"
              params={{ spaceKey: space.key, label }}
              className="relative inline-flex h-full items-center gap-1 rounded-full ps-3 pe-2 after:absolute after:top-1/2 after:left-0 after:h-hit after:w-full after:-translate-y-1/2 hover:underline focus-visible:focus-ring"
            >
              <Tag aria-hidden="true" className="size-icon-sm text-text-muted" />
              {label}
            </Link>
            {canEdit ? (
              <button
                type="button"
                aria-label={t("labels.remove", { label })}
                className="relative inline-flex size-control-sm items-center justify-center rounded-full text-text-muted after:absolute after:top-1/2 after:left-1/2 after:size-hit after:-translate-x-1/2 after:-translate-y-1/2 hover:bg-hover focus-visible:focus-ring"
                onClick={() => void remove(label)}
              >
                <X aria-hidden="true" className="size-icon-sm" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <Popover
          open={open}
          onOpenChange={setOpen}
          trigger={
            <Button variant="outline" size="sm" icon={Plus}>
              {t("labels.add")}
            </Button>
          }
        >
          <div className="flex w-card flex-col gap-2 p-2">
            <Combobox
              aria-label={t("labels.add")}
              placeholder={t("labels.addPlaceholder")}
              emptyText={t("labels.newLabelHint")}
              value={null}
              load={async (query) => {
                const suggestions = await request(() =>
                  api.GET("/api/v1/spaces/{spaceId}/labels", {
                    params: { path: { spaceId: space.id }, query: { q: normalizeLabel(query) } },
                  }),
                );
                const typed = normalizeLabel(query);
                const items = suggestions
                  .filter((label) => !current.includes(label))
                  .map((label) => ({ value: label, label }));
                if (typed && !suggestions.includes(typed) && !current.includes(typed)) {
                  items.unshift({ value: typed, label: t("labels.create", { label: typed }) });
                }
                return { items };
              }}
              onValueChange={(value) => {
                if (value) void add(value);
              }}
            />
          </div>
        </Popover>
      ) : null}
    </div>
  );
}
