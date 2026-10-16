import {
  Button,
  Combobox,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  Input,
  Notice,
  SegmentedControl,
  Textarea,
} from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { itemHref } from "../item-paths.js";
import type { SpaceWithRole } from "../space-queries.js";

export type CreateKind = "page" | "folder" | "link";

export type CreatedKind = "folder" | "link" | "whiteboard";

export function CreateItemDialog({
  space,
  request: pending,
  onOpenChange,
}: {
  space: SpaceWithRole;
  request: { kind: CreatedKind; parentId: string | null } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={onOpenChange}
      title={
        pending?.kind === "link"
          ? t("createItem.linkTitle")
          : pending?.kind === "whiteboard"
            ? t("createItem.whiteboardTitle")
            : t("createItem.folderTitle")
      }
      size="sm"
    >
      {pending ? (
        <CreateItemForm
          key={`${pending.kind}:${pending.parentId}`}
          space={space}
          kind={pending.kind}
          parentId={pending.parentId}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

function CreateItemForm({
  space,
  kind,
  parentId,
  onDone,
}: {
  space: SpaceWithRole;
  kind: CreatedKind;
  parentId: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState<"item" | "url">("item");
  const [itemTarget, setItemTarget] = useState<{ value: string; label: string } | null>(null);
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<{ title?: string; target?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const next: { title?: string; target?: string } = {};
    const linkTitle = title.trim() || (target === "item" ? (itemTarget?.label ?? "") : url.trim());
    if (!linkTitle) next.title = t("createItem.titleRequired");
    if (kind === "link" && target === "item" && !itemTarget) next.target = t("createItem.targetRequired");
    if (kind === "link" && target === "url" && !/^https?:\/\/\S+$/i.test(url.trim()))
      next.target = t("createItem.urlInvalid");
    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalidSoon();
      return;
    }
    setFailure(null);
    setSaving(true);
    try {
      const created = await request(() =>
        api.POST("/api/v1/spaces/{spaceId}/items", {
          params: { path: { spaceId: space.id } },
          body: {
            kind,
            title: linkTitle,
            parentId,
            ...(kind === "folder" ? { description: description.trim() } : {}),
            ...(kind === "link"
              ? { link: target === "item" ? { itemId: itemTarget?.value ?? null } : { url: url.trim() } }
              : {}),
          },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["spaces", space.id, "children"] });
      onDone();
      if (kind === "folder" || kind === "whiteboard") {
        const href = itemHref(created, space.key);
        if (href) await navigate({ to: href });
      }
    } catch (error) {
      setFailure(problemMessage(t, error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {failure ? (
        <Notice variant="danger" title={t("createItem.failed")}>
          {failure}
        </Notice>
      ) : null}
      {kind === "link" ? (
        <>
          <SegmentedControl
            label={t("createItem.target")}
            value={target}
            onValueChange={(value) => setTarget(value as "item" | "url")}
            options={[
              { value: "item", label: t("createItem.targetItem") },
              { value: "url", label: t("createItem.targetUrl") },
            ]}
          />
          {target === "item" ? (
            <Field
              label={t("createItem.targetItemLabel")}
              {...(errors.target ? { error: errors.target } : {})}
            >
              <Combobox
                aria-label={t("createItem.targetItemLabel")}
                value={itemTarget?.value ?? null}
                selectedItem={itemTarget}
                emptyText={t("createItem.noMatch")}
                load={async (query) => {
                  const found = await request(() =>
                    api.GET("/api/v1/items", {
                      params: { query: { limit: 20, ...(query ? { q: query } : {}) } },
                    }),
                  );
                  return {
                    items: found.map((item) => ({
                      value: item.id,
                      label: item.title,
                      description: item.spaceName || item.spaceKey,
                    })),
                  };
                }}
                onValueChange={(value, selected) =>
                  setItemTarget(value && selected ? { value, label: selected.label } : null)
                }
              />
            </Field>
          ) : (
            <Field
              label={t("createItem.url")}
              hint={t("createItem.urlHint")}
              {...(errors.target ? { error: errors.target } : {})}
            >
              <Input
                type="url"
                inputMode="url"
                placeholder={t("createItem.urlPlaceholder")}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
          )}
        </>
      ) : null}
      <Field
        label={t("createItem.title")}
        {...(kind === "link" ? { hint: t("createItem.linkTitleHint") } : {})}
        {...(errors.title ? { error: errors.title } : {})}
      >
        <Input
          autoFocus={kind !== "link"}
          maxLength={255}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      {kind === "folder" ? (
        <Field label={t("createItem.description")} hint={t("createItem.descriptionHint")}>
          <Textarea
            rows={2}
            maxLength={1000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {kind === "link"
            ? t("createItem.createLink")
            : kind === "whiteboard"
              ? t("createItem.createWhiteboard")
              : t("createItem.createFolder")}
        </Button>
      </div>
    </form>
  );
}
