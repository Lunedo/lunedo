import {
  Button,
  Combobox,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Input,
  SegmentedControl,
  Skeleton,
  TruncatedText,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { ArrowDown, ArrowUp, EyeOff, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { ActionFailure, LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { completeWebAddress, isWebAddress } from "../../forms/addresses.js";
import { serverFieldErrors } from "../../forms/use-schema-form.js";
import { managedShortcutsQuery, type Shortcut, shortcutKeys } from "../shortcuts/shortcut-queries.js";
import { useSpace } from "../space-context.js";
import { Panel } from "./panel.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

export const LABEL_MAX = 80;
export const MAX_SHORTCUTS = 20;

type Target = { itemId: string } | { url: string };

function useRefresh() {
  const { space } = useSpace();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: shortcutKeys.list(space.id) });
}

function ShortcutDialog({
  shortcut,
  open,
  onOpenChange,
}: {
  shortcut: Shortcut | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const refresh = useRefresh();
  const [label, setLabel] = useState(shortcut?.label ?? "");
  const [kind, setKind] = useState<"item" | "url">(shortcut?.url ? "url" : "item");
  const [item, setItem] = useState<{ value: string; label: string } | null>(
    shortcut?.item ? { value: shortcut.item.id, label: shortcut.item.title } : null,
  );
  const [url, setUrl] = useState(shortcut?.url ?? "");
  const [errors, setErrors] = useState<{ label?: string; target?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keepsHiddenTarget = shortcut?.hidden === true && kind === "item" && item === null;

  const save = async () => {
    const next: { label?: string; target?: string } = {};
    const typed = label.replace(/\s+/g, " ").trim();
    const cleaned = typed || (kind === "item" ? (item?.label ?? "") : "");
    const address = completeWebAddress(url);
    if (kind === "url" && typed.length === 0) next.label = t("spaceShortcuts.labelRequired");
    else if (cleaned.length > LABEL_MAX) next.label = t("spaceShortcuts.labelTooLong", { max: LABEL_MAX });
    if (kind === "item" && !item && !keepsHiddenTarget) next.target = t("spaceShortcuts.itemRequired");
    if (kind === "url" && !isWebAddress(address)) next.target = t("spaceShortcuts.urlInvalid");
    if (kind === "url") setUrl(address);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    const target: Target | undefined =
      kind === "url" ? { url: address } : item ? { itemId: item.value } : undefined;
    setBusy(true);
    setFailure(null);
    try {
      if (shortcut) {
        await request(() =>
          api.PATCH("/api/v1/spaces/{spaceId}/shortcuts/{shortcutId}", {
            params: { path: { spaceId: space.id, shortcutId: shortcut.id } },
            body: { label: cleaned, ...(target ? { target } : {}) },
          }),
        );
      } else if (target) {
        await request(() =>
          api.POST("/api/v1/spaces/{spaceId}/shortcuts", {
            params: { path: { spaceId: space.id } },
            body: { label: cleaned, target },
          }),
        );
      }
      await refresh();
      toast({
        variant: "success",
        title: shortcut
          ? t("spaceShortcuts.saved", { label: cleaned })
          : t("spaceShortcuts.added", { label: cleaned }),
      });
      onOpenChange(false);
    } catch (error) {
      const fields = serverFieldErrors(t, error);
      const target = fields["target.url"] ?? fields["target.itemId"] ?? fields.target;
      if (fields.label || target) {
        setErrors({ ...(fields.label ? { label: fields.label } : {}), ...(target ? { target } : {}) });
        focusFirstInvalidSoon();
      } else {
        setFailure(problemMessage(t, error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={shortcut ? t("spaceShortcuts.editTitle") : t("spaceShortcuts.addTitle")}
      description={t("spaceShortcuts.dialogDescription")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {shortcut ? t("spaceShortcuts.save") : t("spaceShortcuts.add")}
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
            title={shortcut ? t("spaceShortcuts.saveFailed") : t("spaceShortcuts.addFailed")}
            message={failure}
          />
        ) : null}
        <SegmentedControl
          label={t("spaceShortcuts.target")}
          value={kind}
          onValueChange={(value) => {
            setKind(value as "item" | "url");
            setErrors({});
          }}
          options={[
            { value: "item", label: t("spaceShortcuts.targetItem") },
            { value: "url", label: t("spaceShortcuts.targetUrl") },
          ]}
        />
        {kind === "item" ? (
          <Field
            label={t("spaceShortcuts.itemLabel")}
            hint={keepsHiddenTarget ? t("spaceShortcuts.hiddenTargetKept") : t("spaceShortcuts.itemHint")}
            {...(errors.target ? { error: errors.target } : {})}
          >
            <Combobox
              aria-label={t("spaceShortcuts.itemLabel")}
              value={item?.value ?? null}
              selectedItem={item}
              emptyText={t("spaceShortcuts.noMatch")}
              load={async (query) => {
                const found = await request(() =>
                  api.GET("/api/v1/items", {
                    params: { query: { limit: 20, ...(query ? { q: query } : {}) } },
                  }),
                );
                return {
                  items: found.map((entry) => ({
                    value: entry.id,
                    label: entry.title,
                    description: entry.spaceName || entry.spaceKey,
                  })),
                };
              }}
              onValueChange={(value, selected) => {
                setItem(value && selected ? { value, label: selected.label } : null);
                setErrors({});
              }}
            />
          </Field>
        ) : (
          <Field
            label={t("spaceShortcuts.url")}
            hint={t("spaceShortcuts.urlHint")}
            {...(errors.target ? { error: errors.target } : {})}
          >
            <Input
              type="url"
              inputMode="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setErrors({});
              }}
              onBlur={() => setUrl(completeWebAddress(url))}
            />
          </Field>
        )}
        <Field
          label={t("spaceShortcuts.label")}
          required={kind === "url"}
          hint={
            kind === "url"
              ? t("spaceShortcuts.labelHintWebsite", { max: LABEL_MAX })
              : t("spaceShortcuts.labelHint", { max: LABEL_MAX })
          }
          {...(errors.label ? { error: errors.label } : {})}
        >
          <Input
            value={label}
            placeholder={item?.label ?? t("spaceShortcuts.labelExample")}
            onChange={(event) => {
              setLabel(event.target.value);
              setErrors({});
            }}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function targetText(t: TFunction, shortcut: Shortcut): string {
  if (shortcut.url) return shortcut.url;
  if (shortcut.item)
    return t("spaceShortcuts.itemIn", { title: shortcut.item.title, space: shortcut.item.spaceKey });
  return t("spaceShortcuts.hiddenTarget");
}

export function SpaceShortcutsScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const { toast } = useToast();
  const refresh = useRefresh();
  const admin = space.role === "admin";
  const shortcuts = useQuery({ ...managedShortcutsQuery(space.id), enabled: space.role === "admin" });
  const [editing, setEditing] = useState<Shortcut | "new" | null>(null);

  const reorder = async (ids: string[]) => {
    try {
      await request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/shortcuts/order", {
          params: { path: { spaceId: space.id } },
          body: { ids },
        }),
      );
    } catch (error) {
      toast({
        variant: "error",
        title: t("spaceShortcuts.reorderFailed"),
        description: problemMessage(t, error),
      });
    } finally {
      await refresh();
    }
  };

  const move = (list: Shortcut[], index: number, offset: -1 | 1) => {
    const ids = list.map((entry) => entry.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + offset, 0, moved);
    void reorder(ids);
  };

  const remove = async (list: Shortcut[], shortcut: Shortcut) => {
    try {
      await request(() =>
        api.DELETE("/api/v1/spaces/{spaceId}/shortcuts/{shortcutId}", {
          params: { path: { spaceId: space.id, shortcutId: shortcut.id } },
        }),
      );
      await refresh();
      const target: Target | null = shortcut.url
        ? { url: shortcut.url }
        : shortcut.item
          ? { itemId: shortcut.item.id }
          : null;
      const index = list.findIndex((entry) => entry.id === shortcut.id);
      toast({
        title: t("spaceShortcuts.removed", { label: shortcut.label }),
        ...(target
          ? {
              undo: {
                onUndo: () => {
                  void (async () => {
                    try {
                      const restored = await request(() =>
                        api.POST("/api/v1/spaces/{spaceId}/shortcuts", {
                          params: { path: { spaceId: space.id } },
                          body: { label: shortcut.label, target },
                        }),
                      );
                      const ids = list.filter((entry) => entry.id !== shortcut.id).map((entry) => entry.id);
                      ids.splice(index, 0, restored.id);
                      await reorder(ids);
                    } catch (error) {
                      toast({
                        variant: "error",
                        title: t("spaceShortcuts.restoreFailed"),
                        description: problemMessage(t, error),
                      });
                      await refresh();
                    }
                  })();
                },
              },
            }
          : {}),
      });
    } catch (error) {
      toast({
        variant: "error",
        title: t("spaceShortcuts.removeFailed"),
        description: problemMessage(t, error),
      });
      await refresh();
    }
  };

  return (
    <SpaceSettingsPage title={t("spaceShortcuts.title")} description={t("spaceShortcuts.description")}>
      <Panel
        title={t("spaceShortcuts.title")}
        description={t("spaceShortcuts.panelDescription", { max: MAX_SHORTCUTS })}
        {...(admin && shortcuts.data && shortcuts.data.length < MAX_SHORTCUTS
          ? {
              actions: (
                <Button size="sm" variant="secondary" icon={Plus} onClick={() => setEditing("new")}>
                  {t("spaceShortcuts.add")}
                </Button>
              ),
            }
          : {})}
      >
        {shortcuts.isPending ? <Skeleton className="h-field w-full" /> : null}
        {shortcuts.isError ? (
          <LoadError
            what={t("spaceShortcuts.loadFailed")}
            error={shortcuts.error}
            onRetry={() => shortcuts.refetch()}
          />
        ) : null}
        {shortcuts.data && shortcuts.data.length === 0 ? (
          <p className="text-sm text-text-muted">{t("spaceShortcuts.empty")}</p>
        ) : null}
        {shortcuts.data && shortcuts.data.length >= MAX_SHORTCUTS ? (
          <p className="text-sm text-text-muted">
            {t("spaceShortcuts.limitReached", { max: MAX_SHORTCUTS })}
          </p>
        ) : null}
        {shortcuts.data && shortcuts.data.length > 0 ? (
          <ul aria-label={t("spaceShortcuts.title")} className="flex flex-col divide-y divide-border">
            {shortcuts.data.map((shortcut, index, list) => (
              <li key={shortcut.id} className="flex flex-wrap items-center gap-3 py-3">
                {shortcut.hidden ? (
                  <EyeOff aria-hidden className="size-icon-md shrink-0 text-warning" />
                ) : (
                  <Link2 aria-hidden className="size-icon-md shrink-0 text-text-muted" />
                )}
                <div className="flex min-w-0 flex-1 basis-field flex-col">
                  <TruncatedText text={shortcut.label} className="font-medium" />
                  <TruncatedText text={targetText(t, shortcut)} className="text-sm text-text-muted" />
                  {shortcut.hidden ? (
                    <span className="text-sm text-text-muted">{t("spaceShortcuts.hiddenHint")}</span>
                  ) : null}
                </div>
                {admin ? (
                  <div className="ms-auto flex items-center gap-1">
                    {index > 0 ? (
                      <IconButton
                        label={t("spaceShortcuts.moveUp", { label: shortcut.label })}
                        icon={ArrowUp}
                        onClick={() => move(list, index, -1)}
                      />
                    ) : null}
                    {index < list.length - 1 ? (
                      <IconButton
                        label={t("spaceShortcuts.moveDown", { label: shortcut.label })}
                        icon={ArrowDown}
                        onClick={() => move(list, index, 1)}
                      />
                    ) : null}
                    <IconButton
                      label={t("spaceShortcuts.edit", { label: shortcut.label })}
                      icon={Pencil}
                      onClick={() => setEditing(shortcut)}
                    />
                    <IconButton
                      label={t("spaceShortcuts.remove", { label: shortcut.label })}
                      icon={Trash2}
                      onClick={() => void remove(list, shortcut)}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>
      {editing ? (
        <ShortcutDialog
          key={editing === "new" ? "new" : editing.id}
          shortcut={editing === "new" ? null : editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </SpaceSettingsPage>
  );
}
