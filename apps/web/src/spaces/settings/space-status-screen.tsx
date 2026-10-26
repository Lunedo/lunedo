import {
  Button,
  ConfirmDialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Input,
  type SaveState,
  SaveStatus,
  Select,
  Skeleton,
  useToast,
  VisuallyHidden,
} from "@lunedo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import type { SettingEntry } from "../../api/organization-queries.js";
import { request } from "../../api/request.js";
import { SettingsList } from "../../components/settings-list.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import type { SettingChange } from "../../settings/setting-mutations.js";
import { PAGE_STATUS_KEYS } from "../../settings/settings-index.js";
import { contentKeys } from "../content-queries.js";
import {
  colorName,
  ownershipKeys,
  PAGE_STATUS_COLORS,
  type PageStatusColor,
  type PageStatusValue,
  pageStatusesQuery,
  statusName,
} from "../ownership/ownership-queries.js";
import { StatusBadge } from "../ownership/page-status.js";
import { useSpace } from "../space-context.js";
import { Panel } from "./panel.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

const NAME_MAX_LENGTH = 40;

export function SpaceStatusScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const queryClient = useQueryClient();
  const admin = space.role === "admin";
  const settings = useQuery({
    queryKey: contentKeys.spaceSettings(space.id),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/settings", { params: { path: { spaceId: space.id } } }),
      ),
  });
  const mutation = useMutation({
    mutationFn: ({ key, change }: { key: string; change: SettingChange }) =>
      request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/settings/{key}", {
          params: { path: { spaceId: space.id, key } },
          body: change as never,
        }),
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: contentKeys.spaceSettings(space.id) });
      await queryClient.invalidateQueries({ queryKey: ownershipKeys.statuses(space.id) });
      await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
      await queryClient.invalidateQueries({ queryKey: ["items"] });
    },
  });
  return (
    <SpaceSettingsPage
      title={t("pageStatus.settingsTitle")}
      description={t("pageStatus.settingsDescription")}
    >
      <div className="flex flex-col gap-8">
        <Panel title={t("pageStatus.title")}>
          <SettingsList
            settings={settings.data as unknown as SettingEntry[] | undefined}
            keys={PAGE_STATUS_KEYS}
            level="space"
            organizationName={space.organizationName ?? undefined}
            canManage={() => admin}
            onChange={async (key, change) => {
              await mutation.mutateAsync({ key, change });
            }}
          />
        </Panel>
        <Panel title={t("pageStatus.valuesTitle")} description={t("pageStatus.valuesDescription")}>
          <StatusValues admin={admin} />
        </Panel>
      </div>
    </SpaceSettingsPage>
  );
}

function useRefresh() {
  const { space } = useSpace();
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: ownershipKeys.statuses(space.id) });
    await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
    await queryClient.invalidateQueries({ queryKey: ["items"] });
  };
}

function StatusValues({ admin }: { admin: boolean }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const refresh = useRefresh();
  const values = useQuery(pageStatusesQuery(space.id));
  const [removing, setRemoving] = useState<PageStatusValue | null>(null);

  if (values.isPending) return <Skeleton className="h-card w-full" />;
  if (values.isError) {
    return (
      <LoadError what={t("pageStatus.loadFailed")} error={values.error} onRetry={() => values.refetch()} />
    );
  }
  const list = values.data.values;

  const move = async (index: number, offset: -1 | 1) => {
    const ids = list.map((value) => value.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + offset, 0, moved);
    try {
      await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/page-statuses/order", {
          params: { path: { spaceId: space.id } },
          body: { ids },
        }),
      );
      await refresh();
    } catch (error) {
      toast({
        title: t("pageStatus.reorderFailed"),
        description: problemMessage(t, error),
        variant: "error",
      });
      await refresh();
    }
  };

  if (!admin) {
    return list.length === 0 ? (
      <p className="text-sm text-text-muted">{t("pageStatus.noValues")}</p>
    ) : (
      <ul className="flex flex-wrap gap-2">
        {list.map((value) => (
          <li key={value.id}>
            <StatusBadge status={value} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {list.length === 0 ? <p className="text-sm text-text-muted">{t("pageStatus.noValues")}</p> : null}
      <ul className="flex flex-col divide-y divide-border">
        {list.map((value, index) => (
          <li key={value.id} className="py-3">
            <ValueRow
              value={value}
              position={index + 1}
              first={index === 0}
              last={index === list.length - 1}
              onMove={(offset) => void move(index, offset)}
              onRemove={() => setRemoving(value)}
            />
          </li>
        ))}
      </ul>
      <AddValue count={list.length} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("pageStatus.removeTitle", { name: removing ? statusName(t, removing) : "" })}
        description={
          (removing?.pages ?? 0) > 0
            ? t("pageStatus.removeUsed", { count: removing?.pages ?? 0 })
            : t("pageStatus.removeUnused")
        }
        confirmLabel={t("pageStatus.removeConfirm")}
        cancelLabel={t("pageStatus.keep")}
        destructive
        onConfirm={async () => {
          if (!removing) return;
          try {
            await request(() =>
              api.DELETE("/api/v1/spaces/{spaceId}/page-statuses/{statusId}", {
                params: {
                  path: { spaceId: space.id, statusId: removing.id },
                  query: { pages: removing.pages },
                },
              }),
            );
            toast({ title: t("pageStatus.removed", { name: statusName(t, removing) }), variant: "success" });
            setRemoving(null);
            await refresh();
          } catch (error) {
            await refresh();
            const fresh = (await values.refetch()).data?.values.find((value) => value.id === removing.id);
            if (fresh && fresh.pages !== removing.pages) setRemoving(fresh);
            toast({
              title: t("pageStatus.removeFailed"),
              description: problemMessage(t, error),
              variant: "error",
            });
          }
        }}
      />
    </div>
  );
}

function colorOptions(t: ReturnType<typeof useTranslation>["t"]) {
  return PAGE_STATUS_COLORS.map((color) => ({ value: color, label: colorName(t, color) }));
}

function RowLabel({ visible, spoken }: { visible: string; spoken: string }) {
  return (
    <>
      <span aria-hidden="true">{visible}</span>
      <VisuallyHidden>{spoken}</VisuallyHidden>
    </>
  );
}

function ValueRow({
  value,
  position,
  first,
  last,
  onMove,
  onRemove,
}: {
  value: PageStatusValue;
  position: number;
  first: boolean;
  last: boolean;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const refresh = useRefresh();
  const label = statusName(t, value);
  const [name, setName] = useState(label);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const save = async (changes: { name?: string; color?: PageStatusColor }) => {
    setState("saving");
    setError(null);
    try {
      await request(() =>
        api.PATCH("/api/v1/spaces/{spaceId}/page-statuses/{statusId}", {
          params: { path: { spaceId: space.id, statusId: value.id } },
          body: changes,
        }),
      );
      setState("saved");
      await refresh();
    } catch (failure) {
      setState("error");
      setError(problemMessage(t, failure));
    }
  };

  const saveName = () => {
    const next = name.replace(/\s+/g, " ").trim();
    if (next === label) return;
    if (next.length === 0 || next.length > NAME_MAX_LENGTH) {
      setState("error");
      setError(t("pageStatus.nameLength", { max: NAME_MAX_LENGTH }));
      return;
    }
    void save({ name: next });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={<RowLabel visible={t("pageStatus.name")} spoken={t("pageStatus.nameOf", { position })} />}
          {...(state === "error" && error ? { error } : {})}
        >
          <Input
            value={name}
            maxLength={NAME_MAX_LENGTH + 20}
            invalid={state === "error"}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveName();
              if (event.key === "Escape") setName(label);
            }}
          />
        </Field>
        <Field
          label={<RowLabel visible={t("pageStatus.color")} spoken={t("pageStatus.colorOf", { position })} />}
        >
          <Select
            value={value.color}
            options={colorOptions(t)}
            onValueChange={(color) => void save({ color: color as PageStatusColor })}
          />
        </Field>
        <div className="flex items-center gap-1 pb-1">
          <StatusBadge status={value} />
          <span className="text-sm text-text-muted">{t("pageStatus.usedBy", { count: value.pages })}</span>
        </div>
        <div className="ms-auto flex items-center gap-1">
          {first ? null : (
            <IconButton
              label={t("pageStatus.moveUp", { name: label })}
              icon={ArrowUp}
              onClick={() => onMove(-1)}
            />
          )}
          {last ? null : (
            <IconButton
              label={t("pageStatus.moveDown", { name: label })}
              icon={ArrowDown}
              onClick={() => onMove(1)}
            />
          )}
          <IconButton label={t("pageStatus.removeLabel", { name: label })} icon={Trash2} onClick={onRemove} />
        </div>
      </div>
      <SaveStatus state={state === "error" ? "idle" : state} />
    </div>
  );
}

function AddValue({ count }: { count: number }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState("");
  const [color, setColor] = useState<PageStatusColor>("neutral");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const full = count >= 20;

  const add = async () => {
    const value = name.replace(/\s+/g, " ").trim();
    if (value.length === 0 || value.length > NAME_MAX_LENGTH) {
      setInvalid(t("pageStatus.nameLength", { max: NAME_MAX_LENGTH }));
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    try {
      await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/page-statuses", {
          params: { path: { spaceId: space.id } },
          body: { name: value, color },
        }),
      );
      setName("");
      setInvalid(null);
      toast({ title: t("pageStatus.added", { name: value }), variant: "success" });
      await refresh();
    } catch (error) {
      setInvalid(problemMessage(t, error));
      focusFirstInvalidSoon();
    } finally {
      setBusy(false);
    }
  };

  if (full) return <p className="text-sm text-text-muted">{t("pageStatus.limitReached", { max: 20 })}</p>;
  return (
    <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
      <Field label={t("pageStatus.newName")} {...(invalid ? { error: invalid } : {})}>
        <Input
          value={name}
          placeholder={t("pageStatus.newNameExample")}
          invalid={invalid !== null}
          onChange={(event) => {
            setName(event.target.value);
            if (invalid) setInvalid(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add();
          }}
        />
      </Field>
      <Field label={t("pageStatus.color")}>
        <Select
          value={color}
          options={colorOptions(t)}
          onValueChange={(next) => setColor(next as PageStatusColor)}
        />
      </Field>
      <Button variant="secondary" icon={Plus} loading={busy} onClick={() => void add()}>
        {t("pageStatus.add")}
      </Button>
    </div>
  );
}
